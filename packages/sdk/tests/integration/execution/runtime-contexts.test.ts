import type { UserProfile } from "@edenapp/types";
import * as Effect from "effect/Effect";
import {
  RuntimeContexts,
  RuntimeContextsLive,
} from "../../../src/core/execution/runtime-contexts";
import {
  SessionContext,
  SessionContextLive,
} from "../../../src/desktop/session/context";
import {
  buildService,
  createEffectRuntime,
} from "../../support/effect-runtime";

const serviceEffects = createEffectRuntime();
afterAll(() => serviceEffects.dispose());

const user: UserProfile = {
  username: "operator",
  name: "Operator",
  role: "standard",
  grants: [],
  createdAt: 1,
  updatedAt: 1,
};

describe("RuntimeContexts", () => {
  it("resolves a pre-login session app's system principal", () => {
    const session = serviceEffects.acquireSync(
      buildService(SessionContext, SessionContextLive),
    );
    const registry = serviceEffects.acquireSync(
      buildService(RuntimeContexts, RuntimeContextsLive).pipe(
        Effect.provideService(SessionContext, session),
      ),
    );
    registry.register("com.eden.login", {
      owner: {
        kind: "session",
        sessionId: session.getSessionId(),
        username: null,
      },
      principal: { kind: "system" },
    });

    expect(registry.resolvePrincipal("com.eden.login")).toEqual({
      kind: "system",
    });
  });

  it("rejects a system principal owned by a stale session", () => {
    const session = serviceEffects.acquireSync(
      buildService(SessionContext, SessionContextLive),
    );
    const registry = serviceEffects.acquireSync(
      buildService(RuntimeContexts, RuntimeContextsLive).pipe(
        Effect.provideService(SessionContext, session),
      ),
    );
    registry.register("com.eden.login", {
      owner: { kind: "session", sessionId: "stale", username: null },
      principal: { kind: "system" },
    });

    expect(registry.resolvePrincipal("com.eden.login")).toBeUndefined();
  });

  it("resolves a session user's current profile", () => {
    const session = serviceEffects.acquireSync(
      buildService(SessionContext, SessionContextLive),
    );
    session.setCurrentUser(user);
    const registry = serviceEffects.acquireSync(
      buildService(RuntimeContexts, RuntimeContextsLive).pipe(
        Effect.provideService(SessionContext, session),
      ),
    );
    registry.register("com.example.app", {
      owner: {
        kind: "session",
        sessionId: session.getSessionId(),
        username: user.username,
      },
      principal: { kind: "user", username: user.username },
    });

    expect(registry.resolvePrincipal("com.example.app")).toEqual({
      kind: "user",
      profile: user,
    });
    const refreshed = { ...user, grants: ["files/read"] };
    session.setCurrentUser(refreshed);
    expect(registry.resolvePrincipal("com.example.app")).toEqual({
      kind: "user",
      profile: refreshed,
    });
    session.beginSession(user);
    expect(registry.resolvePrincipal("com.example.app")).toBeUndefined();
  });

  it("retains a detached user's identity across session changes and clears it on scope close", async () => {
    const lifetime = createEffectRuntime();
    const session = lifetime.acquireSync(
      buildService(SessionContext, SessionContextLive),
    );
    const registry = lifetime.acquireSync(
      buildService(RuntimeContexts, RuntimeContextsLive).pipe(
        Effect.provideService(SessionContext, session),
      ),
    );
    try {
      registry.register("detached", {
        owner: { kind: "system" },
        principal: { kind: "user", username: user.username },
        profile: user,
      });
      session.beginSession({ ...user, username: "another-user" });
      expect(registry.resolvePrincipal("detached")).toEqual({
        kind: "user",
        profile: user,
      });
    } finally {
      await lifetime.dispose();
    }
    expect(registry.get("detached")).toBeUndefined();
    expect(registry.resolvePrincipal("detached")).toBeUndefined();
  });
});
