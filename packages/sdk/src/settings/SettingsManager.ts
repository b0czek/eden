import Keyv from "keyv";
import KeyvSqlite from "@keyv/sqlite";
import * as path from "path";
import { singleton, inject } from "tsyringe";
import { SettingsCategory } from "@edenapp/types";
import { CommandRegistry, IPCBridge, EdenNamespace, EdenEmitter } from "../ipc";
import { SettingsHandler, EDEN_SETTINGS_APP_ID } from "./SettingsHandler";
import { EDEN_SETTINGS_SCHEMA } from "./EdenSettings";

/**
 * Events emitted by the SettingsManager
 */
interface SettingsNamespaceEvents {
  changed: { appId: string; key: string; value: string };
}

/**
 * SettingsManager - Manages persistent settings storage for Eden and apps
 *
 * Provides namespace-isolated settings storage using SQLite backend via Keyv.
 * Settings are stored separately from app data in settings.db.
 * Key format: {appId}:{key}
 *
 * Eden system settings use appId "com.eden" which is reserved.
 */
@singleton()
@EdenNamespace("settings")
export class SettingsManager extends EdenEmitter<SettingsNamespaceEvents> {
  private keyv: Keyv;
  private handler: SettingsHandler;

  constructor(
    @inject(IPCBridge) ipcBridge: IPCBridge,
    @inject(CommandRegistry) commandRegistry: CommandRegistry,
    @inject("appsDirectory") appsDirectory: string
  ) {
    super(ipcBridge);
    // Initialize Keyv with SQLite backend - separate from app storage
    const dbPath = path.join(appsDirectory, "settings.db");
    const sqlite = new KeyvSqlite(`sqlite://${dbPath}`);
    this.keyv = new Keyv({ store: sqlite });

    // Handle errors
    this.keyv.on("error", (err) => {
      console.error("[SettingsManager] Database error:", err);
    });

    console.log(`[SettingsManager] Initialized settings storage at ${dbPath}`);

    // Create and register handler
    this.handler = new SettingsHandler(this);
    commandRegistry.registerManager(this.handler);
  }

  // ===================================================================
  // App Settings Methods
  // ===================================================================

  /**
   * Get the namespaced key for an app setting
   */
  private getAppKey(appId: string, key: string): string {
    return `${appId}:${key}`;
  }

  /**
   * Get a setting value for an app
   */
  async get(appId: string, key: string): Promise<string | undefined> {
    const namespacedKey = this.getAppKey(appId, key);
    const value = await this.keyv.get(namespacedKey);

    // If no value found and this is com.eden, check for default
    if (value === undefined && appId === EDEN_SETTINGS_APP_ID) {
      return this.getEdenDefault(key);
    }

    if (value !== undefined && typeof value !== "string") {
      console.warn(
        `[SettingsManager] Non-string value found for key ${key}, converting to string`
      );
      return String(value);
    }
    return value;
  }

  /**
   * Set a setting value for an app
   */
  async set(appId: string, key: string, value: string): Promise<void> {
    if (typeof value !== "string") {
      throw new Error(
        `[SettingsManager] Value must be a string, got ${typeof value}`
      );
    }
    const namespacedKey = this.getAppKey(appId, key);
    await this.keyv.set(namespacedKey, value);

    // Notify subscribers of the change
    this.notify("changed", { appId, key, value });
  }

  /**
   * List all setting keys for an app
   */
  async list(appId: string): Promise<string[]> {
    const prefix = `${appId}:`;
    const allKeys: string[] = [];

    try {
      if (this.keyv.iterator) {
        const iterator = this.keyv.iterator(undefined);
        for await (const [key] of iterator) {
          if (typeof key === "string" && key.startsWith(prefix)) {
            allKeys.push(key.substring(prefix.length));
          }
        }
      }
    } catch (error) {
      console.warn(
        "[SettingsManager] Iterator not supported or failed:",
        error
      );
    }

    return allKeys;
  }

  /**
   * Get all settings with values for an app
   */
  async getAll(appId: string): Promise<Record<string, string>> {
    // For com.eden, return all settings with defaults
    if (appId === EDEN_SETTINGS_APP_ID) {
      return this.getAllEdenSettings();
    }

    const keys = await this.list(appId);
    const result: Record<string, string> = {};

    for (const key of keys) {
      const value = await this.get(appId, key);
      if (value !== undefined) {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Reset a setting to its default value
   */
  async reset(
    appId: string,
    key: string,
    schema?: SettingsCategory[]
  ): Promise<void> {
    // Find default value from schema
    let defaultValue: string | undefined;

    // For com.eden, use built-in schema
    const schemaToUse =
      appId === EDEN_SETTINGS_APP_ID ? EDEN_SETTINGS_SCHEMA : schema;

    if (schemaToUse) {
      for (const category of schemaToUse) {
        const setting = category.settings.find((s) => s.key === key);
        if (setting) {
          defaultValue = setting.defaultValue;
          break;
        }
      }
    }

    if (defaultValue === undefined) {
      throw new Error(
        `[SettingsManager] Cannot reset key "${key}": no default value found in schema`
      );
    }

    await this.set(appId, key, defaultValue);
  }

  // ===================================================================
  // Eden System Settings Helpers
  // ===================================================================

  /**
   * Get Eden settings schema
   */
  getEdenSchema(): SettingsCategory[] {
    return EDEN_SETTINGS_SCHEMA;
  }

  /**
   * Get the default value for an Eden setting key
   */
  private getEdenDefault(key: string): string | undefined {
    for (const category of EDEN_SETTINGS_SCHEMA) {
      const setting = category.settings.find((s) => s.key === key);
      if (setting) {
        return setting.defaultValue;
      }
    }
    return undefined;
  }

  /**
   * Get all Eden settings with values (including defaults)
   */
  private async getAllEdenSettings(): Promise<Record<string, string>> {
    const result: Record<string, string> = {};

    for (const category of EDEN_SETTINGS_SCHEMA) {
      for (const setting of category.settings) {
        const value = await this.get(EDEN_SETTINGS_APP_ID, setting.key);
        if (value !== undefined) {
          result[setting.key] = value;
        }
      }
    }

    return result;
  }
}
