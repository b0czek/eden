import { EdenNamespace, EdenEmitter, IPCBridge, CommandRegistry } from "../ipc";
import { injectable, inject, singleton } from "tsyringe";
import { AppearanceHandler } from "./AppearanceHandler";
import { SettingsManager } from "../settings";
import { WallpaperPreset, WallpaperConfig } from "@edenapp/types";

interface AppearanceEvents {
    "wallpaper-changed": WallpaperPreset;
}

const WALLPAPER_PRESETS: WallpaperPreset[] = [
    // Solid Colors
    { id: "midnight", name: "Midnight", type: "color", value: "#1a1b26" },
    { id: "deep-space", name: "Deep Space", type: "color", value: "#1e1e2e" },
    { id: "charcoal", name: "Charcoal", type: "color", value: "#282c34" },
    { id: "pure-black", name: "Pure Black", type: "color", value: "#000000" },
    { id: "slate", name: "Slate", type: "color", value: "#64748b" },
    // Gradients
    { id: "eden-default", name: "Eden Default", type: "gradient", value: "linear-gradient(135deg, #1e1e2e 0%, #1a1b26 100%)" },
    { id: "aurora", name: "Aurora", type: "gradient", value: "linear-gradient(to right, #43cea2, #185a9d)" },
    { id: "nordic", name: "Nordic", type: "gradient", value: "linear-gradient(to right, #0F2027, #203A43, #2C5364)" },
    { id: "nebula", name: "Nebula", type: "gradient", value: "linear-gradient(to right, #000428, #004e92)" },
    { id: "deep-sea", name: "Deep Sea", type: "gradient", value: "linear-gradient(to top, #2b32b2, #1488cc)" },
    { id: "volcanic", name: "Volcanic", type: "gradient", value: "linear-gradient(to right, #232526, #414345)" },
];

@singleton()
@EdenNamespace("appearance")
export class AppearanceManager extends EdenEmitter<AppearanceEvents> {
    private currentWallpaper: WallpaperPreset = WALLPAPER_PRESETS.find(p => p.id === "eden-default")!;
    private handler: AppearanceHandler;

    constructor(
        @inject(IPCBridge) ipcBridge: IPCBridge,
        @inject(CommandRegistry) commandRegistry: CommandRegistry,
        @inject(SettingsManager) private settingsManager: SettingsManager
    ) {
        super(ipcBridge);
        this.handler = new AppearanceHandler(this);
        commandRegistry.registerManager(this.handler);
    }

    async initialize(): Promise<void> {
        // Load wallpaper from settings
        const savedWallpaper = await this.settingsManager.get("com.eden", "appearance.wallpaper");
        if (savedWallpaper) {
            try {
                const config = JSON.parse(savedWallpaper) as WallpaperConfig;
                this.currentWallpaper = this.resolveWallpaper(config);
            } catch (e) {
                console.error("Failed to parse saved wallpaper config", e);
            }
        }
    }

    async setWallpaper(config: WallpaperConfig): Promise<void> {
        // 1. Save the CONFIG (JSON) to the persistent store (truth for Settings App)
        // SettingsManager expects string, so we stringify the DTO
        await this.settingsManager.set("com.eden", "appearance.wallpaper", JSON.stringify(config));

        // 2. Resolve to PRESET OBJECT (truth for Foundation/Rendering)
        const resolved = this.resolveWallpaper(config);
        this.currentWallpaper = resolved;

        // 3. Emit the RESOLVED DATA (Preset Object) directly
        this.notify("wallpaper-changed", resolved);
    }

    async getWallpaper(): Promise<WallpaperPreset> {
        return this.currentWallpaper;
    }

    public getPresets() {
        return {
            solid: WALLPAPER_PRESETS.filter(p => p.type === "color"),
            gradients: WALLPAPER_PRESETS.filter(p => p.type === "gradient")
        };
    }

    // Internal helper only
    private resolveWallpaper(config: WallpaperConfig): WallpaperPreset {
        if (config.type === "preset") {
            const preset = WALLPAPER_PRESETS.find(p => p.id === config.id);
            return preset ? preset : WALLPAPER_PRESETS.find(p => p.id === "eden-default")!;
        } else if (config.type === "custom") {
            return {
                id: "custom",
                name: "Custom",
                type: "custom",
                value: config.value
            };
        }
        return WALLPAPER_PRESETS.find(p => p.id === "eden-default")!;
    }
}
