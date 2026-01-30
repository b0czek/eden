import { EdenGrants } from "../generated/grants";
import { EdenHandler, EdenNamespace } from "../ipc";
import { AppearanceManager } from "./AppearanceManager";
import { WallpaperPreset, WallpaperConfig } from "@edenapp/types";

@EdenNamespace("appearance")
export class AppearanceHandler {
  constructor(private manager: AppearanceManager) {}

  @EdenHandler("set-wallpaper", { grant: EdenGrants.APPEARANCE })
  async handleSetWallpaper({
    wallpaper,
  }: {
    wallpaper: WallpaperConfig;
  }): Promise<void> {
    await this.manager.setWallpaper(wallpaper);
  }

  @EdenHandler("get-wallpaper")
  async handleGetWallpaper(): Promise<{ wallpaper: WallpaperPreset }> {
    const wallpaper = await this.manager.getWallpaper();
    return { wallpaper };
  }

  @EdenHandler("get-presets")
  async handleGetPresets(): Promise<{
    solid: WallpaperPreset[];
    gradients: WallpaperPreset[];
  }> {
    return this.manager.getPresets();
  }
}
