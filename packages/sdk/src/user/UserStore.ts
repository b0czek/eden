import Keyv from "keyv";
import KeyvSqlite from "@keyv/sqlite";
import * as path from "path";
import type { StoredUser } from "./UserTypes";

const USERS_INDEX_KEY = "users:index";
const DEFAULT_USER_KEY = "users:default";

export class UserStore {
  private keyv: Keyv;

  constructor(appsDirectory: string) {
    const dbPath = path.join(appsDirectory, "users.db");
    const sqlite = new KeyvSqlite(`sqlite://${dbPath}`);
    this.keyv = new Keyv({ store: sqlite });

    this.keyv.on("error", (err) => {
      console.error("[UserManager] Database error:", err);
    });

    console.log(`[UserManager] Initialized user storage at ${dbPath}`);
  }

  async getDefaultUsername(): Promise<string | null> {
    const stored = await this.keyv.get(DEFAULT_USER_KEY);
    if (typeof stored === "string" && stored.length > 0) {
      return stored;
    }
    return null;
  }

  async setDefaultUsername(username: string | null): Promise<void> {
    if (username) {
      await this.keyv.set(DEFAULT_USER_KEY, username);
      return;
    }
    await this.keyv.delete(DEFAULT_USER_KEY);
  }

  async getUserIndex(): Promise<string[]> {
    const value = await this.keyv.get(USERS_INDEX_KEY);
    if (Array.isArray(value)) {
      return value as string[];
    }
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  async getUserRecord(username: string): Promise<StoredUser | null> {
    const value = await this.keyv.get(this.getUserKey(username));
    if (!value) return null;
    if (typeof value === "string") {
      try {
        return this.normalizeStoredUser(JSON.parse(value) as StoredUser);
      } catch {
        return null;
      }
    }
    return this.normalizeStoredUser(value as StoredUser);
  }

  async saveUserRecord(user: StoredUser): Promise<void> {
    await this.keyv.set(this.getUserKey(user.username), user);
    const ids = await this.getUserIndex();
    if (!ids.includes(user.username)) {
      ids.push(user.username);
      await this.setUserIndex(ids);
    }
  }

  async deleteUserRecord(username: string): Promise<void> {
    await this.keyv.delete(this.getUserKey(username));
    const ids = await this.getUserIndex();
    const next = ids.filter((item) => item !== username);
    await this.setUserIndex(next);
  }

  private async setUserIndex(ids: string[]): Promise<void> {
    await this.keyv.set(USERS_INDEX_KEY, ids);
  }

  private getUserKey(username: string): string {
    return `user:${username}`;
  }

  private normalizeStoredUser(user: StoredUser): StoredUser {
    if (!Array.isArray(user.grants)) {
      user.grants = [];
    }
    return user;
  }
}
