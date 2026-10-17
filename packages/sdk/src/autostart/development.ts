import type { EdenConfig } from "@edenapp/types";
import * as Effect from "effect/Effect";
import { loadHotReloadAppsState } from "../hotreload-config";
import type { DevelopmentAutostart } from "./ports";

export function createDevelopmentAutostart(
  config: EdenConfig,
): DevelopmentAutostart {
  return {
    apps: Effect.map(loadHotReloadAppsState(config), (state) => state.apps),
  };
}
