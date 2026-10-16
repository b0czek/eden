import { randomUUID } from "node:crypto";
import type { UserProfile } from "@edenapp/types";

export function createSessionContext() {
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
}
export type SessionContext = ReturnType<typeof createSessionContext>;
