import type {
  AppManifest,
  DlcManifest,
  EdenConfig,
  RuntimeAppManifest,
  RuntimeDlcManifest,
} from "@edenapp/types";
import * as Effect from "effect/Effect";
import { normalizeGrantPresets } from "../grants/presets";
import { getHotReloadDevUrl, isHotReloadConfigured } from "../hotreload-config";
import { normalizeAppIds } from "../utils/normalize";
export function createPackageManifests(config: EdenConfig) {
  const coreApps = normalizeAppIds(config.coreApps);
  const restrictedApps = normalizeAppIds(config.restrictedApps);
  function app(
    manifest: AppManifest,
    isPrebuilt: boolean,
    isDevelopment = false,
  ): RuntimeAppManifest {
    return {
      ...manifest,
      kind: "app" as const,
      isPrebuilt,
      isDevelopment,
      isCore: coreApps.has(manifest.id),
      isRestricted: restrictedApps.has(manifest.id),
      resolvedGrants: normalizeGrantPresets(manifest.grants, manifest.id),
    };
  }
  function dlc(manifest: DlcManifest, isPrebuilt = false): RuntimeDlcManifest {
    return { ...manifest, isPrebuilt };
  }
  const applyHotReloadEntry = Effect.fn(function* (manifest: AppManifest) {
    if (!isHotReloadConfigured(config) || !manifest.frontend?.entry) {
      return manifest;
    }
    const devUrl = yield* getHotReloadDevUrl(manifest.id, config);
    if (!devUrl) {
      return manifest;
    }
    return {
      ...manifest,
      frontend: {
        ...manifest.frontend,
        entry: devUrl,
      },
    };
  });

  return { app, dlc, applyHotReloadEntry };
}
export type PackageManifests = ReturnType<typeof createPackageManifests>;
