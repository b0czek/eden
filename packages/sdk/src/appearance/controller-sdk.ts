import * as v from "valibot";
import type { EdenAppearanceApi } from "../api/control-plane";
import type { SdkContext } from "../api/sdk-context";
import { wallpaperConfigSchema } from "./schemas";
import type { Appearance } from "./service";

export function createAppearanceSdkController({
  appearance,
  sdk,
}: {
  appearance: Appearance;
  sdk: SdkContext;
}): EdenAppearanceApi {
  return {
    getWallpaper: () =>
      sdk.run(() => structuredClone(appearance.getWallpaper())),
    getPresets: () => sdk.run(() => structuredClone(appearance.getPresets())),
    setWallpaper: (input) =>
      sdk.effect(() =>
        appearance.setWallpaper(v.parse(wallpaperConfigSchema, input)),
      ),
    onChanged: (listener) =>
      sdk.subscribe(listener, (notify) =>
        appearance.wallpaperChanged.on(notify),
      ),
  };
}
