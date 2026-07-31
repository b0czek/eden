import { AsyncLocalStorage } from "node:async_hooks";
import type { EdenConfig, UserProfile } from "@edenapp/types";
import { inject, Lifecycle, scoped } from "tsyringe";
import { matchesGrants } from "../user/UserGrants";
import { normalizeAppIds } from "../utils/normalize";

export type EffectivePrincipal =
  | { kind: "system" }
  | { kind: "user"; profile: UserProfile };

export interface CommandCallerContext {
  appId?: string;
  webContentsId?: number;
  principal?: EffectivePrincipal;
  foundation?: boolean;
}

@scoped(Lifecycle.ContainerScoped)
export class ExecutionContext {
  private readonly storage = new AsyncLocalStorage<CommandCallerContext>();
  private readonly coreApps: Set<string>;
  private readonly restrictedApps: Set<string>;

  constructor(@inject("EdenConfig") config: EdenConfig) {
    this.coreApps = normalizeAppIds(config.coreApps);
    this.restrictedApps = normalizeAppIds(config.restrictedApps);
  }

  run<T>(context: CommandCallerContext, task: () => T): T {
    return this.storage.run(context, task);
  }

  get(): CommandCallerContext | undefined {
    return this.storage.getStore();
  }

  getPrincipal(): EffectivePrincipal | undefined {
    return this.get()?.principal;
  }

  hasGrant(grant: string): boolean {
    const principal = this.getPrincipal();
    if (principal?.kind !== "user") return false;
    if (principal.profile.role === "vendor") return true;
    return matchesGrants(principal.profile.grants, grant);
  }

  canLaunchApp(appId: string): boolean {
    const principal = this.getPrincipal();
    if (principal?.kind !== "user") return false;
    if (principal.profile.role === "vendor") return true;
    if (this.restrictedApps.has(appId)) return false;
    if (this.coreApps.has(appId)) return true;
    return matchesGrants(principal.profile.grants, `apps/launch/${appId}`);
  }

  isVendor(): boolean {
    const principal = this.getPrincipal();
    return principal?.kind === "user" && principal.profile.role === "vendor";
  }
}
