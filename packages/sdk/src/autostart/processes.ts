import * as Effect from "effect/Effect";
import type { ExecutionContext } from "../execution/ExecutionContext";
import type { ProcessManager } from "../process-manager/ProcessManager";
import type { AutostartProcesses } from "./ports";

/** Preserve process authorization and drain launches that the legacy manager cannot abort. */
export function createAutostartProcesses(
  processes: Pick<
    ProcessManager,
    "getAppInstance" | "getInstalledManifest" | "launchApp"
  >,
  execution: Pick<ExecutionContext, "run">,
): AutostartProcesses {
  return {
    isRunning: (appId) => processes.getAppInstance(appId) !== undefined,
    installedManifest: (appId) => processes.getInstalledManifest(appId),
    launch: (appId, user) =>
      Effect.tryPromise({
        try: async () => {
          if (user)
            await execution.run(
              { principal: { kind: "user", profile: user } },
              () => processes.launchApp(appId),
            );
          else await processes.launchApp(appId);
        },
        catch: (error) =>
          error instanceof Error ? error : new Error(String(error)),
      }).pipe(Effect.uninterruptible),
  };
}
