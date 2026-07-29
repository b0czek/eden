import { randomBytes } from "node:crypto";
import type { EdenConfig, UserProfile, UserRole } from "@edenapp/types";
import { inject, singleton } from "tsyringe";
import { normalizeAppIds } from "../utils/normalize";
import { hashPassword, verifyPassword } from "./UserAuth";
import { defaultGrantsForRole, normalizeGrants } from "./UserGrants";
import {
  ensureHomeDirectory,
  normalizeHomeDirectory,
} from "./UserHomeDirectory";
import { UserStore } from "./UserStore";
import type { StoredUser } from "./UserTypes";

@singleton()
export class UserManager {
  private store: UserStore;
  private initialized = false;
  private defaultUsername: string | null = null;
  private restrictedApps: Set<string>;

  constructor(
    @inject("EdenConfig") config: EdenConfig,
    @inject("appsDirectory") appsDirectory: string,
    @inject("userDirectory") private userDirectory: string,
  ) {
    this.store = new UserStore(appsDirectory);
    this.restrictedApps = normalizeAppIds(config.restrictedApps);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    await this.loadDefaultUsername();
  }

  async listUsers(): Promise<UserProfile[]> {
    const ids = await this.store.getUserIndex();
    const users: UserProfile[] = [];
    for (const username of ids) {
      const record = await this.store.getUserRecord(username);
      if (record) {
        users.push(this.toPublicUser(record));
      }
    }
    users.sort((a, b) => a.name.localeCompare(b.name));
    return users;
  }

  async createUser(args: {
    username?: string;
    name: string;
    role?: UserRole;
    password: string;
    grants?: string[];
    homeDirectory?: string;
  }): Promise<UserProfile> {
    const username = this.normalizeUsername(args.username, args.name);
    const existing = await this.store.getUserRecord(username);
    if (existing) {
      throw new Error(`User "${username}" already exists`);
    }

    const role = args.role ?? "standard";
    if (role === "vendor") {
      throw new Error("Vendor account can only be seeded");
    }
    const { passwordHash, passwordSalt } = await hashPassword(args.password);
    const now = Date.now();

    const grants = this.normalizeUserGrants(
      role,
      args.grants ?? defaultGrantsForRole(role),
    );
    const homeDirectory = await ensureHomeDirectory(
      this.userDirectory,
      role,
      args.homeDirectory,
    );

    const user: StoredUser = {
      username,
      name: args.name,
      role,
      homeDirectory,
      grants,
      createdAt: now,
      updatedAt: now,
      passwordHash,
      passwordSalt,
    };

    await this.store.saveUserRecord(user);
    return this.toPublicUser(user);
  }

  async updateUser(args: {
    username: string;
    name?: string;
    role?: UserRole;
    grants?: string[];
    homeDirectory?: string | null;
  }): Promise<UserProfile> {
    const user = await this.requireUserRecord(args.username);

    if (user.role === "vendor" && args.role && args.role !== "vendor") {
      throw new Error("Vendor role cannot be changed");
    }
    if (args.role === "vendor" && user.role !== "vendor") {
      throw new Error("Vendor account can only be seeded");
    }

    if (args.name) {
      user.name = args.name;
    }

    if (args.role) {
      user.role = args.role;
      user.grants = this.normalizeUserGrants(user.role, user.grants);
    }

    if (args.grants) {
      user.grants = this.normalizeUserGrants(user.role, args.grants);
    }

    if (args.homeDirectory !== undefined) {
      const homeDirectory = await ensureHomeDirectory(
        this.userDirectory,
        user.role,
        args.homeDirectory,
      );
      if (homeDirectory) {
        user.homeDirectory = homeDirectory;
      } else {
        delete user.homeDirectory;
      }
    } else if (user.homeDirectory) {
      user.homeDirectory = normalizeHomeDirectory(user.homeDirectory);
    }

    user.updatedAt = Date.now();

    await this.store.saveUserRecord(user);

    return this.toPublicUser(user);
  }

  async deleteUser(username: string): Promise<void> {
    const user = await this.requireUserRecord(username);
    if (user.role === "vendor") {
      throw new Error("Vendor account cannot be deleted");
    }

    await this.store.deleteUserRecord(username);
  }

  async setPassword(username: string, password: string): Promise<UserProfile> {
    const user = await this.requireUserRecord(username);
    const { passwordHash, passwordSalt } = await hashPassword(password);
    user.passwordHash = passwordHash;
    user.passwordSalt = passwordSalt;
    user.updatedAt = Date.now();
    await this.store.saveUserRecord(user);
    return this.toPublicUser(user);
  }

  async changePassword(
    username: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<UserProfile> {
    const user = await this.requireUserRecord(username);
    const valid = await verifyPassword(
      currentPassword,
      user.passwordSalt,
      user.passwordHash,
    );
    if (!valid) {
      throw new Error("Invalid password");
    }

    const { passwordHash, passwordSalt } = await hashPassword(newPassword);
    user.passwordHash = passwordHash;
    user.passwordSalt = passwordSalt;
    user.updatedAt = Date.now();
    await this.store.saveUserRecord(user);
    return this.toPublicUser(user);
  }

  async authenticate(username: string, password: string): Promise<UserProfile> {
    const user = await this.requireUserRecord(username);

    if (
      !(await verifyPassword(password, user.passwordSalt, user.passwordHash))
    ) {
      throw new Error("Invalid credentials");
    }

    return this.toPublicUser(user);
  }

  getDefaultUsername(): string | null {
    return this.defaultUsername;
  }

  async setDefaultUsername(username: string | null): Promise<void> {
    if (!username) {
      this.defaultUsername = null;
      await this.store.setDefaultUsername(null);
      return;
    }

    const user = await this.store.getUserRecord(username);
    if (!user) {
      throw new Error(`User "${username}" not found`);
    }

    this.defaultUsername = username;
    await this.store.setDefaultUsername(username);
  }

  private normalizeUsername(
    username: string | undefined,
    name: string,
  ): string {
    if (username && username.trim().length > 0) {
      return username.trim();
    }
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    const suffix = randomBytes(2).toString("hex");
    return `${slug || "user"}-${suffix}`;
  }

  private async requireUserRecord(username: string): Promise<StoredUser> {
    const record = await this.store.getUserRecord(username);
    if (!record) {
      throw new Error(`User "${username}" not found`);
    }
    return record;
  }

  private toPublicUser(user: StoredUser): UserProfile {
    return {
      username: user.username,
      name: user.name,
      role: user.role,
      homeDirectory: user.homeDirectory,
      grants: user.grants,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private async loadDefaultUsername(): Promise<void> {
    this.defaultUsername = await this.store.getDefaultUsername();
  }

  async getDefaultUser(): Promise<UserProfile | null> {
    if (!this.defaultUsername) return null;
    const user = await this.store.getUserRecord(this.defaultUsername);
    return user ? this.toPublicUser(user) : null;
  }

  private normalizeUserGrants(role: UserRole, grants: string[]): string[] {
    const normalized = normalizeGrants(role, grants);
    return this.filterRestrictedAppGrants(role, normalized);
  }

  /**
   * Removes apps/launch/* grants for restricted apps to keep grants tidy.
   * Note: This is cosmetic only - actual restriction is enforced in canLaunchApp()
   * which checks restrictedApps directly, bypassing grants entirely.
   */
  private filterRestrictedAppGrants(
    role: UserRole,
    grants: string[],
  ): string[] {
    if (role === "vendor" || this.restrictedApps.size === 0) {
      return grants;
    }

    return grants.filter((grant) => {
      if (!grant.startsWith("apps/launch/")) {
        return true;
      }

      const appId = grant.slice("apps/launch/".length);
      if (!appId || appId === "*") {
        return true;
      }
      return !this.restrictedApps.has(appId);
    });
  }
}
