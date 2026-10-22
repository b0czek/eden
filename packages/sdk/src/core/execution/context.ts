import { randomUUID } from "node:crypto";
import type { UserProfile } from "@edenapp/types";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import { RuntimeConfig } from "../../runtime/inputs";
import { matchesGrants } from "../user/grants";
import { normalizeAppIds } from "../utils/normalize";

export interface ExecutionContext {
  current: Effect.Effect<CommandCallerContext | undefined>;
  /** Bind lazy work to a caller without starting it or interpreting the Effect. */
  provide: <A, E>(
    work: Effect.Effect<A, E>,
    context: CommandCallerContext,
  ) => Effect.Effect<A, E>;
  /** Synchronous admission checks read only the current Effect fiber's caller. */
  get: () => CommandCallerContext | undefined;
  getPrincipal: () => EffectivePrincipal | undefined;
  hasGrant: (grant: string) => boolean;
  canLaunchApp: (appId: string) => boolean;
  isVendor: () => boolean;
}

export const ExecutionContext = Context.Service<
  "eden/ExecutionContext",
  ExecutionContext
>("eden/ExecutionContext");

export type EffectivePrincipal =
  | { kind: "system" }
  | { kind: "user"; profile: UserProfile };

export interface CommandCallerContext {
  sessionId?: string;
  operationId?: string;
  appId?: string;
  webContentsId?: number;
  principal?: EffectivePrincipal;
  foundation?: boolean;
}

export const ExecutionContextLive = Layer.effect(
  ExecutionContext,
  Effect.gen(function* () {
    const config = yield* RuntimeConfig;
    const caller = Context.Reference<CommandCallerContext | undefined>(
      `eden/Caller/${randomUUID()}`,
      { defaultValue: () => undefined },
    );
    const coreApps = normalizeAppIds(config.coreApps);
    const restrictedApps = normalizeAppIds(config.restrictedApps);
    function get(): CommandCallerContext | undefined {
      return Fiber.getCurrent()?.getRef(caller);
    }
    function getPrincipal(): EffectivePrincipal | undefined {
      return get()?.principal;
    }
    function hasGrant(grant: string): boolean {
      const principal = getPrincipal();
      if (principal?.kind !== "user") return false;
      if (principal.profile.role === "vendor") return true;
      return matchesGrants(principal.profile.grants, grant);
    }
    function canLaunchApp(appId: string): boolean {
      const principal = getPrincipal();
      if (principal?.kind !== "user") return false;
      if (principal.profile.role === "vendor") return true;
      if (restrictedApps.has(appId)) return false;
      if (coreApps.has(appId)) return true;
      return matchesGrants(principal.profile.grants, `apps/launch/${appId}`);
    }
    function isVendor(): boolean {
      const principal = getPrincipal();
      return principal?.kind === "user" && principal.profile.role === "vendor";
    }
    function provide<A, E>(
      work: Effect.Effect<A, E>,
      context: CommandCallerContext,
    ) {
      return Effect.provideService(work, caller, context);
    }
    return {
      current: caller,
      provide,
      get,
      getPrincipal,
      hasGrant,
      canLaunchApp,
      isVendor,
    };
  }),
);
