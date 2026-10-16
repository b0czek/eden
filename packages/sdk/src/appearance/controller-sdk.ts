import * as v from "valibot";
import type { EdenAppearanceApi } from "../api/ControlPlaneApi";
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
    getWallpaper: async () =>
      structuredClone(await sdk.effect(appearance.getWallpaper())),
    getPresets: () => sdk.run(() => structuredClone(appearance.getPresets())),
    setWallpaper: async (input) => {
      const config = v.parse(wallpaperConfigSchema, input);
      await sdk.effect(appearance.setWallpaper(config));
    },
    onChanged: (listener) => {
      v.parse(v.function(), listener);
      return sdk.run(() =>
        appearance.wallpaperChanged.on((wallpaper) =>
          sdk.run(() => listener(structuredClone(wallpaper))),
        ),
      );
    },
  };
}
