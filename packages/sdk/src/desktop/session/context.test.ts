import type { UserProfile } from "@edenapp/types";
import {
  buildService,
  createEffectRuntime,
} from "../../../tests/support/effect-runtime";
import { SessionContext, SessionContextLive } from "./context";

const serviceEffects = createEffectRuntime();
afterAll(() => serviceEffects.dispose());

const user: UserProfile = {
  username: "operator",
  name: "Operator",
  role: "standard",
  grants: ["preset/files/read"],
  createdAt: 1,
  updatedAt: 1,
};

describe("SessionContext", () => {
  it("stores the active user defensively", () => {
    const context = serviceEffects.acquireSync(
      buildService(SessionContext, SessionContextLive),
    );
    context.setCurrentUser(user);

    const returned = context.getCurrentUser();
    expect(returned).toEqual(user);
    returned?.grants.push("mutated");
    expect(context.getCurrentUser()).toEqual(user);
  });

  it("creates a new session identity when a session begins", () => {
    const context = serviceEffects.acquireSync(
      buildService(SessionContext, SessionContextLive),
    );
    const previousSessionId = context.getSessionId();

    context.beginSession(user);

    expect(context.getSessionId()).not.toBe(previousSessionId);
    expect(context.getCurrentUser()).toEqual(user);
  });
});
