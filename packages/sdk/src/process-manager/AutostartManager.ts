import { injectable, inject, singleton } from "tsyringe";
import type { EdenConfig } from "@edenapp/types";
import { ProcessManager } from "./ProcessManager";
import { SettingsManager } from "../settings";
import { EDEN_SETTINGS_APP_ID } from "../settings/SettingsManager";
import { UserManager } from "../user/UserManager";
import { IPCBridge } from "../ipc";

import { log } from "../logging";
/**
 * AutostartManager handles launching applications when Eden starts
 */
@singleton()
@injectable()
export class AutostartManager {
  private static readonly AUTOSTART_KEY_PREFIX = "autostart.";
  private ready = false;
  private launchPromise: Promise<void> = Promise.resolve();

  constructor(
    @inject("EdenConfig") private config: EdenConfig,
    @inject(ProcessManager) private processManager: ProcessManager,
    @inject(SettingsManager) private settingsManager: SettingsManager,
    @inject(UserManager) private userManager: UserManager,
    @inject(IPCBridge) ipcBridge: IPCBridge,
  ) {
    // Subscribe directly to user/changed event
    ipcBridge.eventSubscribers.subscribeInternal(
      "user/changed",
      ({ currentUser, previousUsername }) => {
        const currentUsername = currentUser?.username ?? null;
        if (currentUsername === previousUsername) {
          // Same user, grants may have changed but no session reset
          return;
        }

        if (!this.ready) {
          return;
        }

        if (currentUsername) {
          void this.queueSessionLaunch();
        } else {
          void this.queueLoginLaunch();
        }
      },
    );
  }

  onFoundationReady(): void {
    if (this.ready) return;
    this.ready = true;
    if (this.userManager.getCurrentUser()) {
      void this.queueSessionLaunch();
    } else {
      void this.queueLoginLaunch();
    }
  }

  private queueLaunch(task: () => Promise<void>): Promise<void> {
    this.launchPromise = this.launchPromise.then(task);
    return this.launchPromise;
  }

  private queueSessionLaunch(): Promise<void> {
    return this.queueLaunch(() => this.launchSessionApps());
  }

  private queueLoginLaunch(): Promise<void> {
    return this.queueLaunch(() => this.launchLoginApp());
  }

  private async loadAutostartSettings(): Promise<Map<string, boolean>> {
    const entries = new Map<string, boolean>();
    // Autostart is a system concern; read settings regardless of user grants.
    const keys = await this.settingsManager.list(EDEN_SETTINGS_APP_ID, true);

    for (const key of keys) {
      if (!key.startsWith(AutostartManager.AUTOSTART_KEY_PREFIX)) {
        continue;
      }
      const appId = key.slice(AutostartManager.AUTOSTART_KEY_PREFIX.length);
      const value = await this.settingsManager.get(EDEN_SETTINGS_APP_ID, key);
      entries.set(appId, value === "true");
    }

    return entries;
  }

  private async launchSessionApps(): Promise<void> {
    if (!this.userManager.getCurrentUser()) {
      return;
    }

    try {
      const settings = await this.loadAutostartSettings();
      const enabledApps = Array.from(settings.entries())
        .filter(([, enabled]) => enabled)
        .map(([appId]) => appId);

      for (const appId of enabledApps) {
        if (this.processManager.getAppInstance(appId)) {
          continue;
        }

        try {
          await this.processManager.launchApp(appId);
          log.info(`Autostart app launched: ${appId}`);
        } catch (error) {
          log.error(`Failed to launch autostart app ${appId}:`, error);
        }
      }
    } catch (error) {
      log.warn("Failed to load autostart settings:", error);
    }
  }

  private async launchLoginApp(): Promise<void> {
    if (this.userManager.getCurrentUser()) {
      return;
    }

    const loginAppId = this.config.loginAppId;
    if (!loginAppId) {
      return;
    }

    if (this.processManager.getAppInstance(loginAppId)) {
      return;
    }

    try {
      await this.processManager.launchApp(loginAppId);
      log.info(`Login app launched: ${loginAppId}`);
    } catch (error) {
      log.error(`Failed to launch login app ${loginAppId}:`, error);
    }
  }
}
