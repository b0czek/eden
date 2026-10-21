import * as Effect from "effect/Effect";
import type { Processes } from "../processes/service";
import type { FileOpenProcesses } from "./ports";

export function createFileOpenProcesses(
  processes: Pick<Processes, "getAppInstance" | "launchApp">,
): FileOpenProcesses {
  return {
    isRunning: (appId) => processes.getAppInstance(appId) !== undefined,
    launch: (appId, location) =>
      Effect.asVoid(processes.launchApp(appId, undefined, undefined, location)),
  };
}
