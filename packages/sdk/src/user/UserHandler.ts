import { EdenHandler, EdenNamespace } from "../ipc";
import type { UserManager } from "./UserManager";
import type { UserProfile, UserRole } from "@edenapp/types";

@EdenNamespace("user")
export class UserHandler {
  constructor(private userManager: UserManager) {}

  private assertVendor(): void {
    const user = this.userManager.getCurrentUser();
    if (!user || user.role !== "vendor") {
      throw new Error("Vendor account required");
    }
  }

  /**
   * List all users.
   */
  @EdenHandler("list", { permission: "identity" })
  async handleList(): Promise<{ users: UserProfile[] }> {
    const users = await this.userManager.listUsers();
    return { users };
  }

  /**
   * Return the current logged-in user.
   */
  @EdenHandler("get-current", { permission: "identity" })
  async handleGetCurrent(): Promise<{ user: UserProfile | null }> {
    return { user: this.userManager.getCurrentUser() };
  }

  /**
   * Authenticate a user and establish a session.
   */
  @EdenHandler("login", { permission: "session" })
  async handleLogin(args: {
    username: string;
    password: string;
  }): Promise<{ success: boolean; user?: UserProfile; error?: string }> {
    try {
      const user = await this.userManager.login(args.username, args.password);
      return { success: true, user };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Login failed",
      };
    }
  }

  /**
   * End the current session.
   */
  @EdenHandler("logout", { permission: "session" })
  async handleLogout(): Promise<{ success: boolean }> {
    await this.userManager.logout();
    return { success: true };
  }

  /**
   * Create a new user.
   */
  @EdenHandler("create", { permission: "manage" })
  async handleCreate(args: {
    username?: string;
    name: string;
    role?: UserRole;
    password: string;
    grants?: string[];
  }): Promise<{ user: UserProfile }> {
    this.assertVendor();
    const user = await this.userManager.createUser(args);
    return { user };
  }

  /**
   * Update user profile details or grants.
   */
  @EdenHandler("update", { permission: "manage" })
  async handleUpdate(args: {
    username: string;
    name?: string;
    role?: UserRole;
    grants?: string[];
  }): Promise<{ user: UserProfile }> {
    this.assertVendor();
    const user = await this.userManager.updateUser(args);
    return { user };
  }

  /**
   * Delete a user.
   */
  @EdenHandler("delete", { permission: "manage" })
  async handleDelete(args: {
    username: string;
  }): Promise<{ success: boolean }> {
    this.assertVendor();
    await this.userManager.deleteUser(args.username);
    return { success: true };
  }

  /**
   * Set a user's password.
   */
  @EdenHandler("set-password", { permission: "manage" })
  async handleSetPassword(args: {
    username: string;
    password: string;
  }): Promise<{ success: boolean }> {
    this.assertVendor();
    await this.userManager.setPassword(args.username, args.password);
    return { success: true };
  }

  /**
   * Change the current user's password.
   */
  @EdenHandler("change-password", { permission: "session" })
  async handleChangePassword(args: {
    currentPassword: string;
    newPassword: string;
  }): Promise<{ success: boolean; error?: string }> {
    try {
      await this.userManager.changePassword(
        args.currentPassword,
        args.newPassword
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Change password failed",
      };
    }
  }

  /**
   * Check whether the current user has a specific grant.
   */
  @EdenHandler("has-grant", { permission: "grants" })
  async handleHasGrant(args: { grant: string }): Promise<{ allowed: boolean }> {
    return { allowed: this.userManager.hasGrant(args.grant) };
  }

  /**
   * Return the configured default username.
   */
  @EdenHandler("get-default", { permission: "manage" })
  async handleGetDefault(): Promise<{ username: string | null }> {
    this.assertVendor();
    return { username: this.userManager.getDefaultUsername() };
  }

  /**
   * Update the configured default username.
   */
  @EdenHandler("set-default", { permission: "manage" })
  async handleSetDefault(args: {
    username: string | null;
  }): Promise<{ success: boolean }> {
    this.assertVendor();
    await this.userManager.setDefaultUsername(args.username);
    return { success: true };
  }
}
