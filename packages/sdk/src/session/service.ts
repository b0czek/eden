import type { UserProfile } from "@edenapp/types";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { listen, scopedEvent } from "../events/scoped";
import type { Operations } from "../operations/service";
import type { Users } from "../user/service";
import type { SessionContext } from "./context";

export interface SessionChange {
  currentUser: UserProfile | null;
  previousUsername: string | null;
  reason: "login" | "logout" | "system";
}

export const createSessions = Effect.fn(function* ({
  users,
  context,
  operations,
  processes,
}: {
  users: Pick<Users, "getDefaultUser" | "authenticate" | "changed">;
  context: SessionContext;
  operations: Pick<Operations, "withSessionTransition">;
  processes: { stopSessionApps(sessionId: string): Effect.Effect<void, Error> };
}) {
  const changed = yield* scopedEvent<SessionChange>();
  let transitionInProgress = false;
  const transitionTo = Effect.fn(function* (
    user: UserProfile | null,
    reason: SessionChange["reason"],
  ) {
    const previousUsername = context.getCurrentUser()?.username ?? null;
    const nextUsername = user?.username ?? null;
    if (previousUsername !== nextUsername) {
      yield* processes.stopSessionApps(context.getSessionId());
      context.beginSession(user);
    } else context.setCurrentUser(user);
    changed.emit({
      currentUser: context.getCurrentUser(),
      previousUsername,
      reason,
    });
  });
  function runTransition<A>(work: Effect.Effect<A, Error>) {
    return Effect.suspend(() => {
      if (transitionInProgress)
        return Effect.fail(
          new Error("A session transition is already in progress"),
        );
      transitionInProgress = true;
      return operations.withSessionTransition(work).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            transitionInProgress = false;
          }),
        ),
      );
    });
  }
  const initialization = yield* Effect.cachedWithTTL(
    Effect.gen(function* () {
      const defaultUser = yield* users.getDefaultUser();
      if (defaultUser)
        yield* runTransition(transitionTo(defaultUser, "system"));
    }),
    (exit) => (Exit.isSuccess(exit) ? Duration.infinity : Duration.zero),
  );
  const login = (username: string, password: string) =>
    runTransition(
      Effect.gen(function* () {
        const user = yield* users.authenticate(username, password);
        yield* transitionTo(user, "login");
        return user;
      }),
    );
  const logout = () => runTransition(transitionTo(null, "logout"));
  function synchronizeUser(user: UserProfile) {
    if (context.getCurrentUser()?.username !== user.username) return;
    context.setCurrentUser(user);
    changed.emit({
      currentUser: context.getCurrentUser(),
      previousUsername: user.username,
      reason: "system",
    });
  }
  yield* listen(users.changed, synchronizeUser);
  return {
    initialize: () => initialization,
    login,
    logout,
    getCurrentUser: context.getCurrentUser,
    changed,
  };
});
export type Sessions = Effect.Success<ReturnType<typeof createSessions>>;
