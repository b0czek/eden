import * as Effect from "effect/Effect";
import type { Processes } from "../processes/service";
import type { AutostartProcesses } from "./ports";

/** The startup operation supplies the authority for these launches. */
export function createAutostartProcesses(
  processes: Pick<
    Processes,
    "getAppInstance" | "getInstalledManifest" | "launchApp"
  >,
): AutostartProcesses {
  return {
    isRunning: (appId) => processes.getAppInstance(appId) !== undefined,
    installedManifest: (appId) => processes.getInstalledManifest(appId),
    launch: (appId) => Effect.asVoid(processes.launchApp(appId)),
  };
}
