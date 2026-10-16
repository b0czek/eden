import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { EdenConfig, UserProfile } from "@edenapp/types";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { matchesGrants } from "../user/grants";
import { normalizeAppIds } from "../utils/normalize";

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

export function createExecutionContext({ config }: { config: EdenConfig }) {
  const caller = Context.Reference<CommandCallerContext | undefined>(
    `eden/Caller/${randomUUID()}`,
    { defaultValue: () => undefined },
  );
  let storage = new AsyncLocalStorage<CommandCallerContext>();
  let coreApps: Set<string>;
  let restrictedApps: Set<string>;

  coreApps = normalizeAppIds(config.coreApps);
  restrictedApps = normalizeAppIds(config.restrictedApps);
  function run<T>(context: CommandCallerContext, task: () => T): T {
    const fiber = Fiber.getCurrent();
    const previous = fiber?.context;
    if (fiber) fiber.setContext(Context.add(fiber.context, caller, context));
    try {
      return storage.run(context, task);
    } finally {
      if (fiber && previous) fiber.setContext(previous);
    }
  }
  function get(): CommandCallerContext | undefined {
    return Fiber.getCurrent()?.getRef(caller) ?? storage.getStore();
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
  return { run, provide, get, getPrincipal, hasGrant, canLaunchApp, isVendor };
}
export type ExecutionContext = ReturnType<typeof createExecutionContext>;
