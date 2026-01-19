import { injectable, inject, singleton } from "tsyringe";
import { EdenConfig } from "@edenapp/types";
import { ProcessManager } from "./ProcessManager";
import { SettingsManager } from "../settings";
import { EDEN_SETTINGS_APP_ID } from "../settings/SettingsHandler";

/**
 * AutostartManager handles launching applications when Eden starts
 */
@singleton()
@injectable()
export class AutostartManager {
  private static readonly AUTOSTART_KEY_PREFIX = "autostart.";

  constructor(
    @inject("EdenConfig") private config: EdenConfig,
    @inject(ProcessManager) private processManager: ProcessManager,
    @inject(SettingsManager) private settingsManager: SettingsManager
  ) {}

  private async ensureConfigDefaults(): Promise<void> {
    const defaults = this.config.autostart || [];
    if (defaults.length === 0) {
      return;
    }

    for (const appId of defaults) {
      const key = `${AutostartManager.AUTOSTART_KEY_PREFIX}${appId}`;
      const existing = await this.settingsManager.get(EDEN_SETTINGS_APP_ID, key);
      if (existing === undefined) {
        await this.settingsManager.set(EDEN_SETTINGS_APP_ID, key, "true");
      }
    }
  }

  private async resolveAutostartApps(): Promise<string[]> {
    try {
      await this.ensureConfigDefaults();

      const keys = await this.settingsManager.list(EDEN_SETTINGS_APP_ID);
      const autostartApps: string[] = [];
      let foundAutostartKey = false;

      for (const key of keys) {
        if (!key.startsWith(AutostartManager.AUTOSTART_KEY_PREFIX)) {
          continue;
        }

        foundAutostartKey = true;
        const appId = key.slice(AutostartManager.AUTOSTART_KEY_PREFIX.length);
        const value = await this.settingsManager.get(EDEN_SETTINGS_APP_ID, key);

        if (value === "true") {
          autostartApps.push(appId);
        }
      }

      if (!foundAutostartKey) {
        return this.config.autostart || [];
      }

      return autostartApps;
    } catch (error) {
      console.warn("[AutostartManager] Failed to load autostart settings:", error);
      return this.config.autostart || [];
    }
  }

  /**
   * Launch all autostart applications
   */
  async launchAll(): Promise<void> {
    const autostartApps = await this.resolveAutostartApps();

    if (autostartApps.length === 0) {
      console.log("No autostart apps configured");
      return;
    }

    for (const appId of autostartApps) {
      try {
        await this.processManager.launchApp(appId);
        console.log(`Autostart app launched: ${appId}`);
      } catch (error) {
        console.error(`Failed to launch autostart app ${appId}:`, error);
      }
    }
  }
}
