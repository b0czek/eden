import type { WallpaperConfig, WallpaperPreset } from "@edenapp/types";
import { EdenHandler, EdenNamespace } from "../ipc";
import type { AppearanceManager } from "./AppearanceManager";

@EdenNamespace("appearance")
export class AppearanceHandler {
  constructor(private manager: AppearanceManager) {}

  @EdenHandler("set-wallpaper", { permission: "manage" })
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
