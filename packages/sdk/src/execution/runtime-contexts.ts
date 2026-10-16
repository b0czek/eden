import type {
  ExecutionPrincipal,
  ProcessOwner,
  UserProfile,
} from "@edenapp/types";
import { SessionContext } from "../session/context";
import type { EffectivePrincipal } from "./context";

type RuntimeContext = {
  owner: ProcessOwner;
  principal: ExecutionPrincipal;
  profile?: UserProfile;
};

export function createRuntimeContexts({
  sessionContext,
}: {
  sessionContext: SessionContext;
}) {
  let contexts = new Map<string, RuntimeContext>();

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
}
export type RuntimeContexts = ReturnType<typeof createRuntimeContexts>;
