import * as Context from "effect/Context";
import type { EdenConfig } from "../api/config";
import type { PanelRegistry } from "../core/settings/panels/registry";
import type { EdenPlatform } from "../platform/ports/types";

export interface EdenRuntimePaths {
  appsDirectory: string;
  userDirectory: string;
  distPath: string;
  appPath: string;
}

export interface EdenRuntimeOptions {
  config?: EdenConfig;
  paths: EdenRuntimePaths;
  platform: EdenPlatform;
}

/** Host inputs used by platform adaptation and API integration. */
export interface RuntimeEnvironment {
  config: EdenConfig;
  paths: EdenRuntimePaths;
  platform: EdenPlatform;
  registrations: PanelRegistry;
}
export const RuntimeEnvironment = Context.Service<
  "eden/RuntimeEnvironment",
  RuntimeEnvironment
>("eden/RuntimeEnvironment");
