import { randomBytes } from "crypto";
import { inject, singleton } from "tsyringe";
import { EdenConfig, UserProfile, UserRole } from "@edenapp/types";
import { IPCBridge, CommandRegistry, EdenNamespace, EdenEmitter } from "../ipc";
import { UserHandler } from "./UserHandler";
import { hashPassword, verifyPassword } from "./UserAuth";
import {
  defaultGrantsForRole,
  matchesGrants,
  normalizeCoreApps,
  normalizeGrants,
} from "./UserGrants";
import { UserStore } from "./UserStore";
import { StoredUser } from "./UserTypes";

interface UserNamespaceEvents {
  changed: {
    currentUser: UserProfile | null;
    previousUsername: string | null;
    reason: "login" | "logout" | "system";
  };
}

@singleton()
@EdenNamespace("user")
export class UserManager extends EdenEmitter<UserNamespaceEvents> {
  private store: UserStore;
  private handler: UserHandler;
  private initialized = false;
  private currentUser: StoredUser | null = null;
  private defaultUsername: string | null = null;
  private coreApps: Set<string>;

  constructor(
    @inject(IPCBridge) ipcBridge: IPCBridge,
    @inject(CommandRegistry) commandRegistry: CommandRegistry,
    @inject("EdenConfig") config: EdenConfig,
    @inject("appsDirectory") appsDirectory: string,
  ) {
    super(ipcBridge);
    this.store = new UserStore(appsDirectory);
    this.coreApps = normalizeCoreApps(config.coreApps);

    this.handler = new UserHandler(this);
    commandRegistry.registerManager(this.handler);

    // Register grant checker for declarative grant checks in handlers
    commandRegistry.setGrantChecker((grant) => this.hasGrant(grant));
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    await this.loadDefaultUsername();

    await this.tryAutoLoginDefaultUser();
  }

  getCurrentUser(): UserProfile | null {
    return this.currentUser ? this.toPublicUser(this.currentUser) : null;
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

    const grants = normalizeGrants(
      role,
      args.grants ?? defaultGrantsForRole(role),
    );

    const user: StoredUser = {
      username,
      name: args.name,
      role,
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
      user.grants = normalizeGrants(user.role, user.grants);
    }

    if (args.grants) {
      user.grants = normalizeGrants(user.role, args.grants);
    }

    user.updatedAt = Date.now();

    await this.store.saveUserRecord(user);

    if (this.currentUser?.username === user.username) {
      this.setCurrentUser(user, "system");
    }

    return this.toPublicUser(user);
  }

  async deleteUser(username: string): Promise<void> {
    const user = await this.requireUserRecord(username);
    if (user.role === "vendor") {
      throw new Error("Vendor account cannot be deleted");
    }

    await this.store.deleteUserRecord(username);

    if (this.currentUser?.username === username) {
      await this.setCurrentUser(null, "logout");
    }
  }

  async setPassword(username: string, password: string): Promise<void> {
    const user = await this.requireUserRecord(username);
    const { passwordHash, passwordSalt } = await hashPassword(password);
    user.passwordHash = passwordHash;
    user.passwordSalt = passwordSalt;
    user.updatedAt = Date.now();
    await this.store.saveUserRecord(user);
  }

  async login(username: string, password: string): Promise<UserProfile> {
    const user = await this.requireUserRecord(username);

    if (
      !(await verifyPassword(password, user.passwordSalt, user.passwordHash))
    ) {
      throw new Error("Invalid credentials");
    }

    await this.setCurrentUser(user, "login");
    return this.toPublicUser(user);
  }

  async logout(): Promise<void> {
    await this.setCurrentUser(null, "logout");
  }

  hasGrant(permission: string): boolean {
    if (!this.currentUser) return false;
    if (this.currentUser.role === "vendor") return true;
    const grants = this.currentUser.grants;
    return matchesGrants(grants, permission);
  }

  canLaunchApp(appId: string): boolean {
    if (!this.currentUser) return false;
    if (this.currentUser.role === "vendor") return true;
    if (this.coreApps.has(appId)) return true;
    return matchesGrants(this.currentUser.grants, `apps/launch/${appId}`);
  }

  getAllowedApps(appIds: string[]): string[] {
    return appIds.filter((appId) => this.canLaunchApp(appId));
  }

  canAccessSetting(appId: string, key: string): boolean {
    if (!this.currentUser) return false;
    if (this.currentUser.role === "vendor") return true;
    return matchesGrants(this.currentUser.grants, `settings/${appId}/${key}`);
  }

  getAllowedSettingKeys(appId: string, keys: string[]): string[] {
    return keys.filter((key) => this.canAccessSetting(appId, key));
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

  private async setCurrentUser(
    user: StoredUser | null,
    reason: UserNamespaceEvents["changed"]["reason"],
  ): Promise<void> {
    const previousUsername = this.currentUser?.username ?? null;
    this.currentUser = user;

    this.notify("changed", {
      currentUser: user ? this.toPublicUser(user) : null,
      previousUsername,
      reason,
    });
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
      grants: user.grants,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private async loadDefaultUsername(): Promise<void> {
    this.defaultUsername = await this.store.getDefaultUsername();
  }

  private async tryAutoLoginDefaultUser(): Promise<void> {
    if (!this.defaultUsername) return;
    const user = await this.store.getUserRecord(this.defaultUsername);
    if (!user) return;
    await this.setCurrentUser(user, "system");
  }
}
