import * as Effect from "effect/Effect";
import type { PackageCatalog } from "../packages/catalog";
import type { Processes } from "../processes/service";
import type { AutostartProcesses } from "./ports";

/** The startup operation supplies the authority for these launches. */
export function createAutostartProcesses(
  processes: Pick<Processes, "getAppInstance" | "launchApp">,
  catalog: Pick<PackageCatalog, "getApp">,
): AutostartProcesses {
  return {
    isRunning: (appId) => processes.getAppInstance(appId) !== undefined,
    installedManifest: catalog.getApp,
    launch: (appId) => Effect.asVoid(processes.launchApp(appId)),
  };
}
