import type { EdenConfig, UserProfile } from "@edenapp/types";
import { inject, singleton } from "tsyringe";
import { matchesGrants } from "../user/UserGrants";
import { normalizeAppIds } from "../utils/normalize";

@singleton()
export class SessionContext {
  private currentUser: UserProfile | null = null;
  private readonly coreApps: Set<string>;
  private readonly restrictedApps: Set<string>;

  constructor(@inject("EdenConfig") config: EdenConfig) {
    this.coreApps = normalizeAppIds(config.coreApps);
    this.restrictedApps = normalizeAppIds(config.restrictedApps);
  }

  getCurrentUser(): UserProfile | null {
    return this.currentUser ? this.cloneUser(this.currentUser) : null;
  }

  setCurrentUser(user: UserProfile | null): void {
    this.currentUser = user ? this.cloneUser(user) : null;
  }

  hasGrant(grant: string): boolean {
    if (!this.currentUser) return false;
    if (this.currentUser.role === "vendor") return true;
    return matchesGrants(this.currentUser.grants, grant);
  }

  canLaunchApp(appId: string): boolean {
    if (!this.currentUser) return false;
    if (this.currentUser.role === "vendor") return true;
    if (this.restrictedApps.has(appId)) return false;
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

  private cloneUser(user: UserProfile): UserProfile {
    return { ...user, grants: [...user.grants] };
  }
}
