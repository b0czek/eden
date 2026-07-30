import type {
  ExecutionPrincipal,
  ProcessOwner,
  UserProfile,
} from "@edenapp/types";
import { inject, singleton } from "tsyringe";
import { SessionContext } from "../session/SessionContext";
import type { EffectivePrincipal } from "./ExecutionContext";

type RuntimeContext = {
  owner: ProcessOwner;
  principal: ExecutionPrincipal;
  profile?: UserProfile;
};

@singleton()
export class RuntimeContextRegistry {
  private readonly contexts = new Map<string, RuntimeContext>();

  constructor(@inject(SessionContext) private sessionContext: SessionContext) {}

  register(appId: string, context: RuntimeContext): void {
    this.contexts.set(appId, context);
  }

  unregister(appId: string): void {
    this.contexts.delete(appId);
  }

  get(appId: string): RuntimeContext | undefined {
    return this.contexts.get(appId);
  }

  resolvePrincipal(appId: string): EffectivePrincipal | undefined {
    const context = this.contexts.get(appId);
    if (!context) return undefined;
    if (context.owner.kind === "session") {
      if (context.owner.sessionId !== this.sessionContext.getSessionId()) {
        return undefined;
      }
      if (context.principal.kind === "system") return { kind: "system" };
      const profile = this.sessionContext.getCurrentUser();
      return profile ? { kind: "user", profile } : undefined;
    }
    if (context.principal.kind === "system") return { kind: "system" };
    return context.profile
      ? { kind: "user", profile: context.profile }
      : undefined;
  }
}
