import * as Effect from "effect/Effect";
import * as v from "valibot";
import type { EdenSessionsApi } from "../api/control-plane";
import type { SdkContext } from "../api/sdk-context";
import { operationTask } from "../operations/task";
import { sessionLoginSchema } from "./schemas";
import type { Sessions } from "./service";

export function createSessionsSdkController({
  sessions,
  sdk,
}: {
  sessions: Sessions;
  sdk: SdkContext;
}): EdenSessionsApi {
  return {
    current: () =>
      sdk.run(() => {
        const user = sessions.getCurrentUser();
        return user ? structuredClone(user) : null;
      }),
    login: (username, password) =>
      sdk.effect(() => {
        const args = v.parse(sessionLoginSchema, { username, password });
        return Effect.map(
          sdk.operation(
            "session/login",
            { username: args.username },
            Effect.sync(() =>
              operationTask(
                () =>
                  Effect.map(
                    sessions.login(args.username, args.password),
                    (user) => ({ success: true, user }),
                  ),
                { transition: "session" },
              ),
            ),
          ),
          (result) => structuredClone(result.user),
        );
      }),
    logout: () =>
      Effect.asVoid(
        sdk.operation(
          "session/logout",
          {},
          Effect.sync(() =>
            operationTask(
              () => Effect.map(sessions.logout(), () => ({ success: true })),
              { transition: "session" },
            ),
          ),
        ),
      ),
    onChanged: (listener) =>
      sdk.subscribe(listener, (notify) => sessions.changed.on(notify)),
  };
}
