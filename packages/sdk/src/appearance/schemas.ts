import type { WallpaperConfig } from "@edenapp/types";
import * as v from "valibot";

export const wallpaperConfigSchema: v.GenericSchema<WallpaperConfig> =
  v.variant("type", [
    v.object({ type: v.literal("preset"), id: v.string() }),
    v.object({ type: v.literal("custom"), value: v.string() }),
  ]);
