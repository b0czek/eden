import "reflect-metadata";

import type { UserProfile } from "@edenapp/types";
import { SessionContext } from "./SessionContext";

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
    const context = new SessionContext();
    context.setCurrentUser(user);

    const returned = context.getCurrentUser();
    expect(returned).toEqual(user);
    returned?.grants.push("mutated");
    expect(context.getCurrentUser()).toEqual(user);
  });

  it("creates a new session identity when a session begins", () => {
    const context = new SessionContext();
    const previousSessionId = context.getSessionId();

    context.beginSession(user);

    expect(context.getSessionId()).not.toBe(previousSessionId);
    expect(context.getCurrentUser()).toEqual(user);
  });
});
