import type { SettingsCategory } from "@edenapp/types";
import { EdenHandler, EdenNamespace } from "../ipc";
import type { SettingsManager } from "./SettingsManager";

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
    const value = await this.settingsManager.get(args._callerAppId, args.key);
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
    await this.settingsManager.set(args._callerAppId, args.key, args.value);
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
    await this.settingsManager.reset(args._callerAppId, args.key, args.schema);
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
    this.settingsManager.assertAccess(args.appId, args.key);
    const value = await this.settingsManager.get(args.appId, args.key);
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
    this.settingsManager.assertAccess(args.appId, args.key);
    await this.settingsManager.set(args.appId, args.key, args.value);
    return { success: true };
  }

  /**
   * List all settings in any app's namespace (superuser only)
   * @param showRestricted - If true, includes settings the current user cannot access (hidden by default)
   */
  @EdenHandler("list/su", { permission: "superuser" })
  async handleListSuperuser(args: {
    appId: string;
    showRestricted?: boolean;
  }): Promise<{ keys: string[] }> {
    const keys = await this.settingsManager.list(
      args.appId,
      args.showRestricted,
    );
    return { keys };
  }

  /**
   * Get all settings with values for any app (superuser only)
   * @param showRestricted - If true, includes settings the current user cannot access (hidden by default)
   */
  @EdenHandler("get-all/su", { permission: "superuser" })
  async handleGetAllSuperuser(args: {
    appId: string;
    showRestricted?: boolean;
  }): Promise<{ settings: Record<string, string> }> {
    const settings = await this.settingsManager.getAll(
      args.appId,
      args.showRestricted,
    );
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
    this.settingsManager.assertAccess(args.appId, args.key);
    await this.settingsManager.reset(args.appId, args.key, args.schema);
    return { success: true };
  }

  // ===================================================================
  // Eden Schema Endpoint
  // ===================================================================

  /**
   * Get the Eden settings schema
   * @param showRestricted - If true, includes settings the current user cannot access (hidden by default)
   */
  @EdenHandler("schema")
  async handleSchema(args: {
    showRestricted?: boolean;
  }): Promise<{ schema: SettingsCategory[] }> {
    const schema = this.settingsManager.getEdenSchema(args.showRestricted);
    return { schema };
  }
}
