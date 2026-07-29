import type { UserProfile } from "@edenapp/types";
import { EdenHandler, EdenNamespace } from "../ipc";
import type { SessionManager } from "./SessionManager";

@EdenNamespace("session")
export class SessionHandler {
  constructor(private sessionManager: SessionManager) {}

  @EdenHandler("get-current", { permission: "read" })
  handleGetCurrent(): { user: UserProfile | null } {
    return { user: this.sessionManager.getCurrentUser() };
  }

  @EdenHandler("login", { permission: "manage" })
  async handleLogin(args: {
    username: string;
    password: string;
  }): Promise<{ success: boolean; user?: UserProfile; error?: string }> {
    try {
      const user = await this.sessionManager.login(
        args.username,
        args.password,
      );
      return { success: true, user };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Login failed",
      };
    }
  }

  @EdenHandler("logout", { permission: "manage" })
  async handleLogout(): Promise<{ success: boolean }> {
    await this.sessionManager.logout();
    return { success: true };
  }
}
