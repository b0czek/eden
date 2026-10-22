import type {
  ExecutionPrincipal,
  ProcessOwner,
  UserProfile,
} from "@edenapp/types";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { SessionContext } from "../../desktop/session/context";
import type { EffectivePrincipal } from "./context";

export interface RuntimeContexts {
  register: (appId: string, context: RuntimeContext) => void;
  unregister: (appId: string) => void;
  get: (appId: string) => RuntimeContext | undefined;
  /** Session identities follow the current session; detached identities retain their profile. */
  resolvePrincipal: (appId: string) => EffectivePrincipal | undefined;
  dispose: () => void;
}

export const RuntimeContexts = Context.Service<
  "eden/RuntimeContexts",
  RuntimeContexts
>("eden/RuntimeContexts");

export interface RuntimeContext {
  owner: ProcessOwner;
  principal: ExecutionPrincipal;
  profile?: UserProfile;
}

export const RuntimeContextsLive = Layer.effect(
  RuntimeContexts,
  Effect.acquireRelease(
    Effect.gen(function* () {
      const sessionContext = yield* SessionContext;
      const contexts = new Map<string, RuntimeContext>();

      function register(appId: string, context: RuntimeContext): void {
        contexts.set(appId, context);
      }
      function unregister(appId: string): void {
        contexts.delete(appId);
      }
      function get(appId: string): RuntimeContext | undefined {
        return contexts.get(appId);
      }
      function resolvePrincipal(appId: string): EffectivePrincipal | undefined {
        const context = contexts.get(appId);
        if (!context) return undefined;
        if (context.owner.kind === "session") {
          if (context.owner.sessionId !== sessionContext.getSessionId()) {
            return undefined;
          }
          if (context.principal.kind === "system") return { kind: "system" };
          const profile = sessionContext.getCurrentUser();
          return profile ? { kind: "user", profile } : undefined;
        }
        if (context.principal.kind === "system") return { kind: "system" };
        return context.profile
          ? { kind: "user", profile: context.profile }
          : undefined;
      }
      function dispose(): void {
        contexts.clear();
      }
      return { register, unregister, get, resolvePrincipal, dispose };
    }),
    (value) => Effect.sync(value.dispose),
  ),
);
