import type { SessionChange, UserProfile } from "@edenapp/types";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import { Processes } from "../../applications/processes/service";
import type { Event } from "../../core/events/event";
import { listen, scopedEvent } from "../../core/events/scoped";
import { SessionTransitionInProgress } from "../../core/operations/errors";
import { Operations } from "../../core/operations/service";
import { Users } from "../../core/user/service";
import { SessionContext } from "./context";
import type {
  InitializeSessionFailure,
  LoginFailure,
  SessionTransitionFailure,
} from "./errors";

export interface Sessions {
  initialize: () => Effect.Effect<void, InitializeSessionFailure>;
  login: (
    username: string,
    password: string,
  ) => Effect.Effect<UserProfile, LoginFailure>;
  logout: () => Effect.Effect<void, SessionTransitionFailure>;
  getCurrentUser: () => UserProfile | null;
  changed: Event<SessionChange>;
}

export const Sessions = Context.Service<"eden/Sessions", Sessions>(
  "eden/Sessions",
);

export const SessionsLive = Layer.effect(
  Sessions,
  Effect.gen(function* () {
    const users = yield* Users;
    const context = yield* SessionContext;
    const operations = yield* Operations;
    const processes = yield* Processes;
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
    function runTransition<A, E>(work: Effect.Effect<A, E>) {
      return Effect.suspend(() => {
        if (transitionInProgress)
          return Effect.fail(
            new SessionTransitionInProgress({
              sessionId: context.getSessionId(),
            }),
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
  }),
);
