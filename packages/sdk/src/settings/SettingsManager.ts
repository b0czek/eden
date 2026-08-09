import * as path from "node:path";
import type { SettingsCategory } from "@edenapp/types";
import KeyvSqlite from "@keyv/sqlite";
import Keyv from "keyv";
import { delay, inject, Lifecycle, scoped } from "tsyringe";
import { PackageCatalog } from "../package-manager/PackageCatalog";
import { ExecutionContext } from "../execution/ExecutionContext";
import { CommandRegistry, EdenEmitter, EdenNamespace, IPCBridge } from "../ipc";
import { log } from "../logging";
import { EDEN_SETTINGS_APP_ID } from "./constants";
import { EDEN_SETTINGS_SCHEMA } from "./EdenSettings";
import { SettingsHandler } from "./SettingsHandler";

/**
 * Reserved app ID for Eden system settings.
 * No external app can use this ID.
 */
export { EDEN_SETTINGS_APP_ID } from "./constants";

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
@scoped(Lifecycle.ContainerScoped)
@EdenNamespace("settings")
export class SettingsManager extends EdenEmitter<SettingsNamespaceEvents> {
  private keyv: Keyv;
  private handler: SettingsHandler;

  constructor(
    @inject(delay(() => IPCBridge)) ipcBridge: IPCBridge,
    @inject(CommandRegistry) commandRegistry: CommandRegistry,
    @inject("appsDirectory") appsDirectory: string,
    @inject(delay(() => PackageCatalog)) private packageCatalog: PackageCatalog,
    @inject(ExecutionContext) private executionContext: ExecutionContext,
  ) {
    super(ipcBridge);

    // Initialize Keyv with SQLite backend - separate from app storage
    const dbPath = path.join(appsDirectory, "settings.db");
    const sqlite = new KeyvSqlite(`sqlite://${dbPath}`);
    this.keyv = new Keyv({ store: sqlite });

    // Handle errors
    this.keyv.on("error", (err) => {
      log.error("Database error:", err);
    });

    log.info(`Initialized settings storage at ${dbPath}`);

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

    if (value === undefined) {
      return this.getDefault(appId, key);
    }

    if (value !== undefined && typeof value !== "string") {
      log.warn(`Non-string value found for key ${key}, converting to string`);
      return String(value);
    }
    return value;
  }

  /**
   * Set a setting value for an app
   */
  async set(appId: string, key: string, value: string): Promise<void> {
    if (typeof value !== "string") {
      throw new Error(`Value must be a string, got ${typeof value}`);
    }
    const namespacedKey = this.getAppKey(appId, key);
    await this.keyv.set(namespacedKey, value);

    this.notify("changed", { appId, key, value });
  }

  async delete(appId: string, key: string): Promise<void> {
    await this.keyv.delete(this.getAppKey(appId, key));
  }

  /**
   * List all setting keys for an app
   * @param showRestricted - If true, includes keys the current user cannot access (for superuser use)
   */
  async list(appId: string, showRestricted?: boolean): Promise<string[]> {
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
      log.warn("Iterator not supported or failed:", error);
    }

    if (showRestricted) {
      return allKeys;
    }
    return this.filterAllowedKeys(appId, allKeys);
  }

  /**
   * Get all settings with values for an app
   * @param showRestricted - If true, includes settings the current user cannot access (for superuser use)
   */
  async getAll(
    appId: string,
    showRestricted?: boolean,
  ): Promise<Record<string, string>> {
    // For com.eden, return all settings with defaults
    if (appId === EDEN_SETTINGS_APP_ID) {
      return this.getAllEdenSettings(showRestricted);
    }

    const keys = await this.list(appId, showRestricted);
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
    schema?: SettingsCategory[],
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
        `Cannot reset key "${key}": no default value found in schema`,
      );
    }

    await this.set(appId, key, defaultValue);
  }

  // ===================================================================
  // Eden System Settings Helpers
  // ===================================================================

  /**
   * Get the default value for an Eden setting key
   */
  private getDefault(appId: string, key: string): string | undefined {
    return this.getSettingDefinition(appId, key)?.defaultValue;
  }

  /**
   * Get all Eden settings with values (including defaults)
   */
  private async getAllEdenSettings(
    showRestricted?: boolean,
  ): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    const schema = showRestricted
      ? EDEN_SETTINGS_SCHEMA
      : this.filterSchemaByGrants(EDEN_SETTINGS_SCHEMA);

    for (const category of schema) {
      for (const setting of category.settings) {
        const value = await this.get(EDEN_SETTINGS_APP_ID, setting.key);
        if (value !== undefined) {
          result[setting.key] = value;
        }
      }
    }

    return result;
  }

  // ===================================================================
  // Access Control Methods
  // ===================================================================

  private getSettingDefinition(appId: string, key: string) {
    const schema =
      appId === EDEN_SETTINGS_APP_ID
        ? EDEN_SETTINGS_SCHEMA
        : this.packageCatalog.getApp(appId)?.settings;

    for (const category of schema ?? []) {
      const setting = category.settings.find(
        (candidate) => candidate.key === key,
      );
      if (setting) return setting;
    }
    return undefined;
  }

  canRead(ownerAppId: string, key: string, readerAppId: string): boolean {
    if (ownerAppId === readerAppId) return true;
    return (
      this.getSettingDefinition(ownerAppId, key)?.sharedWith?.includes(
        readerAppId,
      ) ?? false
    );
  }

  assertReadableBy(ownerAppId: string, key: string, readerAppId: string): void {
    if (ownerAppId === readerAppId) {
      return;
    }

    const setting = this.getSettingDefinition(ownerAppId, key);
    if (!setting) {
      throw new Error(
        `Setting "${key}" does not exist for app "${ownerAppId}"`,
      );
    }
    if (!this.canRead(ownerAppId, key, readerAppId)) {
      throw new Error("Caller is not allowed to read this setting");
    }
    this.assertAccess(ownerAppId, key);
  }

  /**
   * Resolve the grant key for a setting.
   * For Eden settings, uses the setting's explicit grant or falls back to the key itself.
   */
  resolveGrantKey(appId: string, settingKey: string): string {
    if (appId !== EDEN_SETTINGS_APP_ID) {
      return settingKey;
    }
    for (const category of EDEN_SETTINGS_SCHEMA) {
      for (const setting of category.settings) {
        if (setting.key === settingKey) {
          return setting.grant ?? settingKey;
        }
      }
    }
    return settingKey;
  }

  /**
   * Assert the current user has access to a setting, throwing if not.
   */
  assertAccess(appId: string, key: string): void {
    const grantKey = this.resolveGrantKey(appId, key);
    if (!this.canAccessSetting(appId, grantKey)) {
      throw new Error("User does not have grant to access this setting");
    }
  }

  /**
   * Filter a list of keys to only those the current user can access.
   */
  filterAllowedKeys(appId: string, keys: string[]): string[] {
    if (appId !== EDEN_SETTINGS_APP_ID) {
      return keys.filter((key) => this.canAccessSetting(appId, key));
    }
    return keys.filter((key) => {
      const grantKey = this.resolveGrantKey(EDEN_SETTINGS_APP_ID, key);
      return this.canAccessSetting(EDEN_SETTINGS_APP_ID, grantKey);
    });
  }

  /**
   * Filter the Eden settings schema to only categories/settings the current user can access.
   */
  filterSchemaByGrants(categories: SettingsCategory[]): SettingsCategory[] {
    return categories
      .map((category) => ({
        ...category,
        settings: category.settings.filter((setting) => {
          const grantKey = setting.grant ?? setting.key;
          return this.canAccessSetting(EDEN_SETTINGS_APP_ID, grantKey);
        }),
      }))
      .filter((category) => {
        if (category.view && category.grant) {
          return this.executionContext.hasGrant(category.grant);
        }
        // For regular categories, must have at least one setting
        return category.settings.length > 0;
      });
  }

  private canAccessSetting(appId: string, key: string): boolean {
    return this.executionContext.hasGrant(`settings/${appId}/${key}`);
  }

  override async dispose(): Promise<void> {
    super.dispose();
    await this.keyv.disconnect();
  }
}
