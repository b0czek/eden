import * as path from "node:path";
import KeyvSqlite from "@keyv/sqlite";
import Keyv from "keyv";
import { inject, injectable, singleton } from "tsyringe";
import { CommandRegistry } from "../ipc";
import { log } from "../logging";
import { DbHandler } from "./DbHandler";
/**
 * DbManager - Manages persistent key-value storage for Eden apps
 *
 * Provides namespace-isolated storage using SQLite backend via Keyv.
 * Each app gets its own namespace, preventing cross-app data access.
 */
@singleton()
@injectable()
export class DbManager {
  private keyv: Keyv;
  private handler: DbHandler;

  constructor(
    @inject(CommandRegistry) commandRegistry: CommandRegistry,
    @inject("appsDirectory") appsDirectory: string,
  ) {
    // Initialize Keyv with SQLite backend
    const dbPath = path.join(appsDirectory, "storage.db");
    const sqlite = new KeyvSqlite(`sqlite://${dbPath}`);
    this.keyv = new Keyv({ store: sqlite });

    // Handle errors
    this.keyv.on("error", (err) => {
      log.error("Database error:", err);
    });

    log.info(`Initialized storage at ${dbPath}`);

    // Create and register handler
    this.handler = new DbHandler(this);
    commandRegistry.registerManager(this.handler);
  }

  /**
   * Get the namespaced key for an app
   */
  private getNamespacedKey(appId: string, key: string): string {
    return `${appId}:${key}`;
  }

  /**
   * Extract app ID from a namespaced key
   */
  private extractAppId(namespacedKey: string): string {
    const colonIndex = namespacedKey.indexOf(":");
    return colonIndex > 0 ? namespacedKey.substring(0, colonIndex) : "";
  }

  /**
   * Extract the original key from a namespaced key
   */
  private extractKey(namespacedKey: string): string {
    const colonIndex = namespacedKey.indexOf(":");
    return colonIndex > 0
      ? namespacedKey.substring(colonIndex + 1)
      : namespacedKey;
  }

  /**
   * Get a value from storage for an app
   */
  async get(appId: string, key: string): Promise<string | undefined> {
    const namespacedKey = this.getNamespacedKey(appId, key);
    const value = await this.keyv.get(namespacedKey);
    // Runtime check: ensure we always return string or undefined
    if (value !== undefined && typeof value !== "string") {
      log.warn(`Non-string value found for key ${key}, converting to string`);
      return String(value);
    }
    return value;
  }

  /**
   * Set a value in storage for an app
   */
  async set(appId: string, key: string, value: string): Promise<void> {
    // Runtime check: ensure value is a string
    if (typeof value !== "string") {
      throw new Error(`Value must be a string, got ${typeof value}`);
    }
    const namespacedKey = this.getNamespacedKey(appId, key);
    await this.keyv.set(namespacedKey, value);
  }

  /**
   * Delete a key from storage for an app
   */
  async delete(appId: string, key: string): Promise<boolean> {
    const namespacedKey = this.getNamespacedKey(appId, key);
    return await this.keyv.delete(namespacedKey);
  }

  /**
   * Clear all keys for an app
   */
  async clear(appId: string): Promise<void> {
    const keys = await this.list(appId);
    for (const key of keys) {
      await this.delete(appId, key);
    }
  }

  /**
   * List all keys for an app
   */
  async list(appId: string): Promise<string[]> {
    const prefix = `${appId}:`;
    const allKeys: string[] = [];

    // Keyv's iterator requires a namespace parameter and may not be available on all stores
    try {
      if (this.keyv.iterator) {
        const iterator = this.keyv.iterator(undefined);
        for await (const [key] of iterator) {
          if (typeof key === "string" && key.startsWith(prefix)) {
            allKeys.push(this.extractKey(key));
          }
        }
      }
    } catch (error) {
      log.warn("Iterator not supported or failed:", error);
    }

    return allKeys;
  }

  /**
   * Check if a key exists for an app
   */
  async has(appId: string, key: string): Promise<boolean> {
    const namespacedKey = this.getNamespacedKey(appId, key);
    const value = await this.keyv.get(namespacedKey);
    return value !== undefined;
  }
}
