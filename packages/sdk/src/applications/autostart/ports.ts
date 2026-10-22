import type { RuntimeAppManifest } from "@edenapp/types";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type { ProcessLaunchError } from "../processes/errors";

export interface AutostartConfig {
  readonly development: boolean;
  readonly loginAppId?: string;
}
export const AutostartConfig = Context.Service<
  "eden/AutostartConfig",
  AutostartConfig
>("eden/AutostartConfig");

export interface AutostartProcesses {
  isRunning(appId: string): boolean;
  installedManifest(appId: string): RuntimeAppManifest | undefined;
  launch(appId: string): Effect.Effect<void, ProcessLaunchError>;
}
export const AutostartProcesses = Context.Service<
  "eden/AutostartProcesses",
  AutostartProcesses
>("eden/AutostartProcesses");

export interface DevelopmentAutostart {
  readonly apps: Effect.Effect<
    readonly { id: string; launchOnStart: boolean }[]
  >;
}
export const DevelopmentAutostart = Context.Service<
  "eden/DevelopmentAutostart",
  DevelopmentAutostart
>("eden/DevelopmentAutostart");
