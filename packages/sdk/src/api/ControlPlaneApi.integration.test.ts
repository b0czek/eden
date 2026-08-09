import "reflect-metadata";
import type {
  RuntimeAppManifest,
  RuntimeDlcManifest,
  UserProfile,
} from "@edenapp/types";
import { PackageRegistry } from "../package-manager/PackageRegistry";
import { createTestEden, type TestEden } from "../testing/createTestEden";

describe("control-plane API integration", () => {
  let eden: TestEden;

  afterEach(async () => {
    await eden?.dispose();
  });

  it("lists trusted package inventory without a user session", async () => {
    eden = await createTestEden();
    const app: RuntimeAppManifest = {
      kind: "app",
      id: "com.example.sessionless-app",
      name: "Sessionless App",
      version: "1.0.0",
      frontend: { entry: "index.html" },
      isPrebuilt: false,
      isDevelopment: false,
      isCore: false,
      isRestricted: true,
      resolvedGrants: [],
    };
    const dlc: RuntimeDlcManifest = {
      kind: "dlc",
      id: "com.example.sessionless-dlc",
      name: "Sessionless DLC",
      version: "1.0.0",
      hostAppId: app.id,
      contributions: [],
      isPrebuilt: false,
    };
    const registry = eden.runtime.resolve(PackageRegistry);
    registry.register(app);
    registry.register(dlc);

    expect(eden.runtime.sessions.current()).toBeNull();
    expect(eden.runtime.packages.list()).toEqual([app, dlc]);
    expect(eden.runtime.packages.list({ kind: "app" })).toEqual([app]);
    expect(eden.runtime.packages.list({ kind: "dlc" })).toEqual([dlc]);
  });

  it("returns detached data and synchronizes session changes", async () => {
    eden = await createTestEden();
    const app = {
      kind: "app",
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
    eden.runtime.resolve(PackageRegistry).register(app);

    const user = await eden.runtime.users.create({
      username: "operator",
      name: "Operator",
      password: "password",
      grants: [`apps/launch/${app.id}`],
    });
    await eden.runtime.sessions.login(user.username, "password");

    const listed = eden.runtime.packages.list();
    expect(listed).toHaveLength(1);
    listed[0].name = "Changed by host";
    expect(eden.runtime.packages.get(app.id)?.manifest.name).toBe(
      "Control Plane App",
    );

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
