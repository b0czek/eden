import type { UserProfile } from "@edenapp/types";
import * as v from "valibot";
import { EdenHandler, EdenNamespace } from "../ipc";
import { type OperationTask, operationTask } from "../operations/OperationTask";
import type { SessionManager } from "./SessionManager";

@EdenNamespace("session")
export class SessionHandler {
  constructor(private sessionManager: SessionManager) {}

  @EdenHandler("get-current", { permission: "read" })
  handleGetCurrent(): { user: UserProfile | null } {
    return { user: this.sessionManager.getCurrentUser() };
  }

  @EdenHandler("login", { permission: "manage", mode: "operation" })
  handleLogin(args: {
    username: string;
    password: string;
  }): OperationTask<{ success: boolean; user?: UserProfile; error?: string }> {
    const { username, password } = v.parse(
      v.object({ username: v.string(), password: v.string() }),
      args,
    );
    return operationTask(
      async (reporter) => {
        reporter.update("authenticating");
        try {
          const user = await this.sessionManager.login(username, password);
          return { success: true, user };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Login failed",
          };
        }
      },
      { transition: "session" },
    );
  }

  @EdenHandler("logout", { permission: "manage", mode: "operation" })
  handleLogout(): OperationTask<{ success: boolean }> {
    return operationTask(
      async (reporter) => {
        reporter.update("logging-out");
        await this.sessionManager.logout();
        return { success: true };
      },
      { transition: "session" },
    );
  }
}
