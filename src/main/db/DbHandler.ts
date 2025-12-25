import { EdenHandler, EdenNamespace } from "../ipc";
import type { DbManager } from "./DbManager";

/**
 * DbHandler - IPC layer for database operations
 *
 * Provides two sets of endpoints:
 * 1. Regular endpoints - require "db/rw" permission, automatically scoped to caller's appId
 * 2. Superuser endpoints - require "db/superuser" permission for cross-namespace access
 */
@EdenNamespace("db")
export class DbHandler {
  constructor(private dbManager: DbManager) {}

  // ===================================================================
  // Regular Endpoints - Scoped to caller's app
  // ===================================================================

  /**
   * Get a value from database (scoped to caller's app)
   */
  @EdenHandler("get", { permission: "rw" })
  async handleGet(args: {
    key: string;
    _callerAppId: string;
  }): Promise<{ value: any | undefined }> {
    const { key } = args;
    const value = await this.dbManager.get(args._callerAppId, key);
    return { value };
  }

  /**
   * Set a value in database (scoped to caller's app)
   */
  @EdenHandler("set", { permission: "rw" })
  async handleSet(args: {
    key: string;
    value: any;
    _callerAppId: string;
  }): Promise<{ success: boolean }> {
    const { key, value } = args;
    await this.dbManager.set(args._callerAppId, key, value);
    return { success: true };
  }

  /**
   * Delete a key from database (scoped to caller's app)
   */
  @EdenHandler("delete", { permission: "rw" })
  async handleDelete(args: {
    key: string;
    _callerAppId: string;
  }): Promise<{ success: boolean }> {
    const { key } = args;
    const deleted = await this.dbManager.delete(args._callerAppId, key);
    return { success: deleted };
  }

  /**
   * Check if a key exists (scoped to caller's app)
   */
  @EdenHandler("has", { permission: "rw" })
  async handleHas(args: {
    key: string;
    _callerAppId: string;
  }): Promise<{ exists: boolean }> {
    const { key } = args;
    const exists = await this.dbManager.has(args._callerAppId, key);
    return { exists };
  }

  /**
   * Clear all keys (scoped to caller's app)
   */
  @EdenHandler("clear", { permission: "rw" })
  async handleClear(args: {
    _callerAppId: string;
  }): Promise<{ success: boolean }> {
    await this.dbManager.clear(args._callerAppId);
    return { success: true };
  }

  /**
   * List all keys (scoped to caller's app)
   */
  @EdenHandler("list", { permission: "rw" })
  async handleList(args: {
    _callerAppId: string;
  }): Promise<{ keys: string[] }> {
    const keys = await this.dbManager.list(args._callerAppId);
    return { keys };
  }

  // ===================================================================
  // Superuser Endpoints - Cross-namespace access
  // ===================================================================

  /**
   * Get a value from any app's namespace (superuser only)
   */
  @EdenHandler("get/su", { permission: "superuser" })
  async handleGetSuperuser(args: {
    appId: string;
    key: string;
  }): Promise<{ value: any | undefined }> {
    const { appId, key } = args;
    const value = await this.dbManager.get(appId, key);
    return { value };
  }

  /**
   * Set a value in any app's namespace (superuser only)
   */
  @EdenHandler("set/su", { permission: "superuser" })
  async handleSetSuperuser(args: {
    appId: string;
    key: string;
    value: any;
  }): Promise<{ success: boolean }> {
    const { appId, key, value } = args;
    await this.dbManager.set(appId, key, value);
    return { success: true };
  }

  /**
   * Delete a key from any app's namespace (superuser only)
   */
  @EdenHandler("delete/su", { permission: "superuser" })
  async handleDeleteSuperuser(args: {
    appId: string;
    key: string;
  }): Promise<{ success: boolean }> {
    const { appId, key } = args;
    const deleted = await this.dbManager.delete(appId, key);
    return { success: deleted };
  }

  /**
   * Check if a key exists in any app's namespace (superuser only)
   */
  @EdenHandler("has/su", { permission: "superuser" })
  async handleHasSuperuser(args: {
    appId: string;
    key: string;
  }): Promise<{ exists: boolean }> {
    const { appId, key } = args;
    const exists = await this.dbManager.has(appId, key);
    return { exists };
  }

  /**
   * Clear all keys in any app's namespace (superuser only)
   */
  @EdenHandler("clear/su", { permission: "superuser" })
  async handleClearSuperuser(args: {
    appId: string;
  }): Promise<{ success: boolean }> {
    const { appId } = args;
    await this.dbManager.clear(appId);
    return { success: true };
  }

  /**
   * List all keys in any app's namespace (superuser only)
   */
  @EdenHandler("list/su", { permission: "superuser" })
  async handleListSuperuser(args: {
    appId: string;
  }): Promise<{ keys: string[] }> {
    const { appId } = args;
    const keys = await this.dbManager.list(appId);
    return { keys };
  }
}
