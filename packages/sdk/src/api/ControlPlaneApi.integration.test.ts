import "reflect-metadata";
import type { RuntimeAppManifest, UserProfile } from "@edenapp/types";
import { AppRegistry } from "../app-registry/AppRegistry";
import { createTestEden, type TestEden } from "../testing/createTestEden";

describe("control-plane API integration", () => {
  let eden: TestEden;

  afterEach(async () => {
    await eden?.dispose();
  });

  it("returns detached data and synchronizes session changes", async () => {
    eden = await createTestEden();
    const app = {
      id: "com.example.control-plane",
      name: "Control Plane App",
      version: "1.0.0",
      frontend: { entry: "index.html" },
      isPrebuilt: false,
      isDevelopment: false,
      isCore: false,
      isRestricted: false,
      resolvedGrants: [],
    } as RuntimeAppManifest;
    eden.runtime.resolve(AppRegistry).register(app);

    const user = await eden.runtime.users.create({
      username: "operator",
      name: "Operator",
      password: "password",
      grants: [`apps/launch/${app.id}`],
    });
    await eden.runtime.sessions.login(user.username, "password");

    const listed = eden.runtime.apps.list();
    expect(listed).toHaveLength(1);
    listed[0].name = "Changed by host";
    expect(eden.runtime.apps.get(app.id)?.name).toBe("Control Plane App");

    const changes: Array<UserProfile | null> = [];
    const unsubscribe = eden.runtime.sessions.onChanged(({ currentUser }) => {
      changes.push(currentUser);
    });
    const updated = await eden.runtime.users.update({
      username: user.username,
      name: "Renamed",
    });
    expect(eden.runtime.sessions.current()).toMatchObject({ name: "Renamed" });
    expect(updated).not.toBe(eden.runtime.sessions.current());

    await eden.runtime.sessions.logout();
    unsubscribe();
    unsubscribe();
    await eden.runtime.sessions.login(user.username, "password");
    expect(changes).toEqual([
      expect.objectContaining({ username: user.username, name: "Renamed" }),
      null,
    ]);
  });
});
