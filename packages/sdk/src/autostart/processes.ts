import * as Effect from "effect/Effect";
import type { ExecutionContext } from "../execution/ExecutionContext";
import type { ProcessManager } from "../process-manager/ProcessManager";
import type { AutostartProcesses } from "./ports";

/** Launch autostart apps under the selected account authority. */
export function createAutostartProcesses(
  processes: Pick<
    ProcessManager,
    "getAppInstance" | "getInstalledManifest" | "launchApp"
  >,
  execution: Pick<ExecutionContext, "provide">,
): AutostartProcesses {
  return {
    isRunning: (appId) => processes.getAppInstance(appId) !== undefined,
    installedManifest: (appId) => processes.getInstalledManifest(appId),
    launch: (appId, user) =>
      Effect.asVoid(
        user
          ? execution.provide(processes.launchApp(appId), {
              principal: { kind: "user", profile: user },
            })
          : processes.launchApp(appId),
      ),
  };
}
