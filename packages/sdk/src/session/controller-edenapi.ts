import type { UserProfile } from "@edenapp/types";
import * as Effect from "effect/Effect";
import {
  command,
  defineController,
  operation,
} from "../controllers/controller";
import type { SessionManager } from "./SessionManager";
import { sessionLoginSchema } from "./schemas";

export function createSessionController(sessions: SessionManager) {
  return defineController("session", {
    commands: {
      "get-current": command({
        permission: "read",
        handle: () => ({ user: sessions.getCurrentUser() }),
      }),
      login: operation({
        permission: "manage",
        input: sessionLoginSchema,
        transition: "session",
        prepare:
          ({ username, password }) =>
          (reporter) => {
            reporter.update("authenticating");
            return sessions.login(username, password).pipe(
              Effect.map(
                (
                  user,
                ): {
                  success: boolean;
                  user?: UserProfile;
                  error?: string;
                } => ({ success: true, user }),
              ),
              Effect.catch((error) =>
                Effect.succeed({ success: false, error: error.message }),
              ),
            );
          },
      }),
      logout: operation({
        permission: "manage",
        transition: "session",
        prepare: () => (reporter) => {
          reporter.update("logging-out");
          return Effect.map(sessions.logout(), (): { success: boolean } => ({
            success: true,
          }));
        },
      }),
    },
    events: { changed: sessions.changed },
  });
}
