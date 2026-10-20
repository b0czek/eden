import { randomUUID } from "node:crypto";
import type { UserProfile } from "@edenapp/types";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export interface SessionContext {
  getCurrentUser: () => UserProfile | null;
  setCurrentUser: (user: UserProfile | null) => void;
  getSessionId: () => string;
  beginSession: (user: UserProfile | null) => void;
  dispose: () => void;
}

export const SessionContext = Context.Service<
  "eden/SessionContext",
  SessionContext
>("eden/SessionContext");

export const SessionContextLive = Layer.effect(
  SessionContext,
  Effect.acquireRelease(
    Effect.sync(() => {
      let currentUser: UserProfile | null = null;
      let sessionId = randomUUID();

      function getCurrentUser(): UserProfile | null {
        return currentUser ? cloneUser(currentUser) : null;
      }
      function setCurrentUser(user: UserProfile | null): void {
        currentUser = user ? cloneUser(user) : null;
      }
      function getSessionId(): string {
        return sessionId;
      }
      function beginSession(user: UserProfile | null): void {
        sessionId = randomUUID();
        setCurrentUser(user);
      }
      function cloneUser(user: UserProfile): UserProfile {
        return { ...user, grants: [...user.grants] };
      }
      function dispose(): void {
        currentUser = null;
      }
      return {
        getCurrentUser,
        setCurrentUser,
        getSessionId,
        beginSession,
        dispose,
      };
    }),
    (value) => Effect.sync(value.dispose),
  ),
);
