import * as Effect from "effect/Effect";
import * as v from "valibot";
import type { EdenDaemonsApi } from "../api/ControlPlaneApi";
import type { SdkContext } from "../api/sdk-context";
import { operationTask } from "../operations/OperationTask";
import type { DaemonManager } from "./DaemonManager";
import { daemonAppIdSchema, daemonDefinitionSchema } from "./schemas";
export function createDaemonsSdkController({
  daemons,
  sdk,
}: {
  daemons: DaemonManager;
  sdk: SdkContext;
}): EdenDaemonsApi {
  const retained = (
    action: "start" | "stop" | "restart",
    appId: string,
    phase: string,
  ) => {
    const input = v.parse(daemonAppIdSchema, appId);
    return sdk.operation(`daemon/${action}`, { appId: input }, () =>
      operationTask((reporter) => {
        reporter.update(phase);
        return Effect.map(daemons[action](input), () => ({ success: true }));
      }),
    );
  };
  return {
    list: async () => structuredClone(await sdk.effect(daemons.list())),
    updateDefinition: async (definition) =>
      sdk.effect(
        daemons.updateDefinition(v.parse(daemonDefinitionSchema, definition)),
      ),
    setEnabled: async (appId, enabled) => {
      const input = v.parse(
        v.object({ appId: daemonAppIdSchema, enabled: v.boolean() }),
        { appId, enabled },
      );
      await sdk.effect(daemons.setEnabled(input.appId, input.enabled));
    },
    start: async (appId) => {
      await retained("start", appId, "starting-daemon");
    },
    stop: async (appId) => {
      await retained("stop", appId, "stopping-daemon");
    },
    restart: async (appId) => {
      await retained("restart", appId, "restarting-daemon");
    },
    onChanged: (listener) => {
      v.parse(v.function(), listener);
      return sdk.run(() =>
        daemons.changed.on(({ status }) =>
          sdk.run(() => listener(structuredClone(status))),
        ),
      );
    },
  };
}
