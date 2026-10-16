import * as Effect from "effect/Effect";
import * as v from "valibot";
import type { EdenSessionsApi } from "../api/ControlPlaneApi";
import type { SdkContext } from "../api/sdk-context";
import { operationTask } from "../operations/OperationTask";
import type { SessionManager } from "./SessionManager";
import { sessionLoginSchema } from "./schemas";

export function createSessionsSdkController({
  sessions,
  sdk,
}: {
  sessions: SessionManager;
  sdk: SdkContext;
}): EdenSessionsApi {
  return {
    current: () =>
      sdk.run(() => {
        const user = sessions.getCurrentUser();
        return user ? structuredClone(user) : null;
      }),
    login: async (username, password) => {
      const args = v.parse(sessionLoginSchema, { username, password });
      const result = await sdk.operation(
        "session/login",
        { username: args.username },
        () =>
          operationTask(
            () =>
              Effect.map(
                sessions.login(args.username, args.password),
                (user) => ({ success: true, user }),
              ),
            { transition: "session" },
          ),
      );
      return structuredClone(result.user);
    },
    logout: async () => {
      await sdk.operation("session/logout", {}, () =>
        operationTask(
          () => Effect.map(sessions.logout(), () => ({ success: true })),
          { transition: "session" },
        ),
      );
    },
    onChanged: (listener) => {
      v.parse(v.function(), listener);
      return sdk.run(() =>
        sessions.changed.on((change) =>
          sdk.run(() => listener(structuredClone(change))),
        ),
      );
    },
  };
}
