import { SettingsCategory } from "@edenapp/types/AppManifest";
import { EdenHandler, EdenNamespace } from "../ipc";
import type { SettingsManager } from "./SettingsManager";

/**
 * Reserved app ID for Eden system settings.
 * No external app can use this ID.
 */
export const EDEN_SETTINGS_APP_ID = "com.eden";

/**
 * SettingsHandler - IPC layer for settings operations
 *
 * Provides multiple sets of endpoints:
 * 1. Regular endpoints - require "settings/rw" permission, scoped to caller's appId
 * 2. Superuser endpoints - require "settings/superuser" permission for cross-namespace access
 *
 * Eden system settings use appId "com.eden" via superuser endpoints.
 */
@EdenNamespace("settings")
export class SettingsHandler {
  constructor(private settingsManager: SettingsManager) {}

  // ===================================================================
  // Regular Endpoints - Scoped to caller's app
  // ===================================================================

  /**
   * Get a setting value (scoped to caller's app)
   */
  @EdenHandler("get", { permission: "rw" })
  async handleGet(args: {
    key: string;
    _callerAppId: string;
  }): Promise<{ value: string | undefined }> {
    const { key } = args;
    const value = await this.settingsManager.get(args._callerAppId, key);
    return { value };
  }

  /**
   * Set a setting value (scoped to caller's app)
   */
  @EdenHandler("set", { permission: "rw" })
  async handleSet(args: {
    key: string;
    value: string;
    _callerAppId: string;
  }): Promise<{ success: boolean }> {
    const { key, value } = args;
    await this.settingsManager.set(args._callerAppId, key, value);
    return { success: true };
  }

  /**
   * List all settings keys (scoped to caller's app)
   */
  @EdenHandler("list", { permission: "rw" })
  async handleList(args: {
    _callerAppId: string;
  }): Promise<{ keys: string[] }> {
    const keys = await this.settingsManager.list(args._callerAppId);
    return { keys };
  }

  /**
   * Get all settings with values (scoped to caller's app)
   */
  @EdenHandler("get-all", { permission: "rw" })
  async handleGetAll(args: {
    _callerAppId: string;
  }): Promise<{ settings: Record<string, string> }> {
    const settings = await this.settingsManager.getAll(args._callerAppId);
    return { settings };
  }

  /**
   * Reset a setting to default (scoped to caller's app)
   */
  @EdenHandler("reset", { permission: "rw" })
  async handleReset(args: {
    key: string;
    schema?: SettingsCategory[];
    _callerAppId: string;
  }): Promise<{ success: boolean }> {
    const { key, schema } = args;
    await this.settingsManager.reset(args._callerAppId, key, schema);
    return { success: true };
  }

  // ===================================================================
  // Superuser Endpoints - Cross-namespace access
  // ===================================================================

  /**
   * Get a setting from any app's namespace (superuser only)
   */
  @EdenHandler("get/su", { permission: "superuser" })
  async handleGetSuperuser(args: {
    appId: string;
    key: string;
  }): Promise<{ value: string | undefined }> {
    const { appId, key } = args;
    const value = await this.settingsManager.get(appId, key);
    return { value };
  }

  /**
   * Set a setting in any app's namespace (superuser only)
   */
  @EdenHandler("set/su", { permission: "superuser" })
  async handleSetSuperuser(args: {
    appId: string;
    key: string;
    value: string;
  }): Promise<{ success: boolean }> {
    const { appId, key, value } = args;
    await this.settingsManager.set(appId, key, value);
    return { success: true };
  }

  /**
   * List all settings in any app's namespace (superuser only)
   */
  @EdenHandler("list/su", { permission: "superuser" })
  async handleListSuperuser(args: {
    appId: string;
  }): Promise<{ keys: string[] }> {
    const { appId } = args;
    const keys = await this.settingsManager.list(appId);
    return { keys };
  }

  /**
   * Get all settings with values for any app (superuser only)
   */
  @EdenHandler("get-all/su", { permission: "superuser" })
  async handleGetAllSuperuser(args: {
    appId: string;
  }): Promise<{ settings: Record<string, string> }> {
    const { appId } = args;
    const settings = await this.settingsManager.getAll(appId);
    return { settings };
  }

  /**
   * Reset a setting for any app (superuser only)
   */
  @EdenHandler("reset/su", { permission: "superuser" })
  async handleResetSuperuser(args: {
    appId: string;
    key: string;
    schema?: SettingsCategory[];
  }): Promise<{ success: boolean }> {
    const { appId, key, schema } = args;
    await this.settingsManager.reset(appId, key, schema);
    return { success: true };
  }

  // ===================================================================
  // Eden Schema Endpoint
  // ===================================================================

  /**
   * Get the Eden settings schema
   */
  @EdenHandler("schema")
  async handleSchema(): Promise<{ schema: SettingsCategory[] }> {
    const schema = this.settingsManager.getEdenSchema();
    return { schema };
  }
}
