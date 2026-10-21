import * as Effect from "effect/Effect";
import * as v from "valibot";
import type { EdenDaemonsApi } from "../api/control-plane";
import type { SdkContext } from "../api/sdk-context";
import { operationTask } from "../operations/task";
import type { DaemonLaunchError, DaemonStopError } from "./errors";
import { daemonAppIdSchema, daemonDefinitionSchema } from "./schemas";
import type { Daemons } from "./service";
export function createDaemonsSdkController({
  daemons,
  sdk,
}: {
  daemons: Daemons;
  sdk: SdkContext;
}): EdenDaemonsApi {
  const retained = (
    action: "start" | "stop" | "restart",
    appId: string,
    phase: string,
  ) =>
    sdk.effect(() => {
      const input = v.parse(daemonAppIdSchema, appId);
      return Effect.asVoid(
        sdk.operation(
          `daemon/${action}`,
          { appId: input },
          Effect.sync(() =>
            operationTask((reporter) => {
              reporter.update(phase);
              const work: Effect.Effect<
                void,
                DaemonLaunchError | DaemonStopError
              > = daemons[action](input);
              return Effect.map(work, () => ({
                success: true,
              }));
            }),
          ),
        ),
      );
    });
  return {
    list: () => sdk.effect(() => Effect.map(daemons.list(), structuredClone)),
    updateDefinition: (definition) =>
      sdk.effect(() =>
        daemons.updateDefinition(v.parse(daemonDefinitionSchema, definition)),
      ),
    setEnabled: (appId, enabled) =>
      sdk.effect(() => {
        const input = v.parse(
          v.object({ appId: daemonAppIdSchema, enabled: v.boolean() }),
          { appId, enabled },
        );
        return daemons.setEnabled(input.appId, input.enabled);
      }),
    start: (appId) => retained("start", appId, "starting-daemon"),
    stop: (appId) => retained("stop", appId, "stopping-daemon"),
    restart: (appId) => retained("restart", appId, "restarting-daemon"),
    onChanged: (listener) =>
      sdk.subscribe(listener, (notify) =>
        daemons.changed.on(({ status }) => notify(status)),
      ),
  };
}
