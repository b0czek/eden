import type { EdenConfig } from "@edenapp/types";
import * as Effect from "effect/Effect";
import { loadHotReloadAppsState } from "../hotreload-config";
import type { DevelopmentAutostart } from "./ports";

export function createDevelopmentAutostart(
  config: EdenConfig,
): DevelopmentAutostart {
  return {
    apps: Effect.tryPromise({
      try: async () => (await loadHotReloadAppsState(config)).apps,
      catch: (error) =>
        error instanceof Error ? error : new Error(String(error)),
    }),
  };
}
