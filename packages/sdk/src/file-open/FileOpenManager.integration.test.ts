import "reflect-metadata";
import type { RuntimeAppManifest } from "@edenapp/types";
import { PackageRegistry } from "../package-manager/PackageRegistry";
import { createTestEden, type TestEden } from "../testing/createTestEden";

describe("FileOpenManager integration", () => {
  let eden: TestEden;

  afterEach(async () => {
    await eden?.dispose();
  });

  it("persists associations through commands and reports compatibility data", async () => {
    eden = await createTestEden();
    const filesApp = {
      kind: "app",
      id: "com.eden.files",
      name: "Files",
      version: "1.0.0",
      frontend: { entry: "index.html" },
      fileHandlers: [{ name: "Directories", directories: true }],
      isPrebuilt: false,
      isDevelopment: false,
      isCore: false,
      isRestricted: false,
      resolvedGrants: [],
    } as RuntimeAppManifest;
    eden.runtime.resolve(PackageRegistry).register(filesApp);
    const user = await eden.runtime.users.create({
      username: "files-user",
      name: "Files User",
      password: "password",
    });
    await eden.runtime.sessions.login(user.username, "password");
    await eden.execute("fs/mkdir", { path: "/Documents" });

    await eden.execute("file/set-default-handler", {
      path: "/Documents",
      appId: filesApp.id,
    });

    await expect(
      eden.execute("file/get-handler", { path: "/Documents" }),
    ).resolves.toEqual({ appId: filesApp.id });
    await expect(eden.execute("file/get-associations")).resolves.toEqual({
      directory: { default: filesApp.id, userOverride: filesApp.id },
    });
    expect(eden.runtime.associations.get("file:directory")).toEqual({
      appId: filesApp.id,
      kind: "file.directory",
    });

    await eden.execute("file/remove-default-handler", { path: "/Documents" });
    expect(eden.runtime.associations.get("file:directory")).toBeUndefined();
  });
});
