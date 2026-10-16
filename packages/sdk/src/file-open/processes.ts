import * as Effect from "effect/Effect";
import type { ProcessManager } from "../process-manager";
import type { FileOpenProcesses } from "./ports";

export function createFileOpenProcesses(
  processes: Pick<ProcessManager, "getAppInstance" | "launchApp">,
): FileOpenProcesses {
  return {
    isRunning: (appId) => processes.getAppInstance(appId) !== undefined,
    launch: (appId, location) =>
      Effect.tryPromise({
        try: async () => {
          await processes.launchApp(appId, undefined, undefined, location);
        },
        catch: (error) =>
          error instanceof Error ? error : new Error(String(error)),
      }).pipe(Effect.uninterruptible),
  };
}
