import type { UserProfile } from "@edenapp/types";
import * as Effect from "effect/Effect";
import { scopedEvent } from "../events/scoped";
import type { OperationManager } from "../operations/OperationManager";
import type { UserManager } from "../user/UserManager";
import type { SessionContext } from "./SessionContext";

export interface SessionChange {
  currentUser: UserProfile | null;
  previousUsername: string | null;
  reason: "login" | "logout" | "system";
}

export const createSessionManager = Effect.fn(function* ({
  users,
  context,
  operations,
  processes,
}: {
  users: Pick<UserManager, "getDefaultUser" | "authenticate">;
  context: SessionContext;
  operations: Pick<OperationManager, "withSessionTransition">;
  processes: { stopSessionApps(sessionId: string): Effect.Effect<void, Error> };
}) {
  const changed = yield* scopedEvent<SessionChange>();
  let initialized = false;
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
  const initialize = Effect.fn(function* () {
    if (initialized) return;
    const defaultUser = yield* users.getDefaultUser();
    if (defaultUser) yield* runTransition(transitionTo(defaultUser, "system"));
    initialized = true;
  });
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
  return {
    initialize,
    login,
    logout,
    synchronizeUser,
    getCurrentUser: context.getCurrentUser,
    changed,
  };
});
export type SessionManager = Effect.Success<
  ReturnType<typeof createSessionManager>
>;
