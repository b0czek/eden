import { randomUUID } from "node:crypto";
import type { UserProfile } from "@edenapp/types";
import { singleton } from "tsyringe";

@singleton()
export class SessionContext {
  private currentUser: UserProfile | null = null;
  private sessionId = randomUUID();

  getCurrentUser(): UserProfile | null {
    return this.currentUser ? this.cloneUser(this.currentUser) : null;
  }

  setCurrentUser(user: UserProfile | null): void {
    this.currentUser = user ? this.cloneUser(user) : null;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  beginSession(user: UserProfile | null): void {
    this.sessionId = randomUUID();
    this.setCurrentUser(user);
  }

  private cloneUser(user: UserProfile): UserProfile {
    return { ...user, grants: [...user.grants] };
  }
}
