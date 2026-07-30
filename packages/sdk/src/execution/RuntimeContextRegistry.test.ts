import "reflect-metadata";

import type { UserProfile } from "@edenapp/types";
import { SessionContext } from "../session";
import { RuntimeContextRegistry } from "./RuntimeContextRegistry";

const user: UserProfile = {
  username: "operator",
  name: "Operator",
  role: "standard",
  grants: [],
  createdAt: 1,
  updatedAt: 1,
};

describe("RuntimeContextRegistry", () => {
  it("resolves a pre-login session app's system principal", () => {
    const session = new SessionContext();
    const registry = new RuntimeContextRegistry(session);
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
    const session = new SessionContext();
    const registry = new RuntimeContextRegistry(session);
    registry.register("com.eden.login", {
      owner: { kind: "session", sessionId: "stale", username: null },
      principal: { kind: "system" },
    });

    expect(registry.resolvePrincipal("com.eden.login")).toBeUndefined();
  });

  it("resolves a session user's current profile", () => {
    const session = new SessionContext();
    session.setCurrentUser(user);
    const registry = new RuntimeContextRegistry(session);
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
  });
});
