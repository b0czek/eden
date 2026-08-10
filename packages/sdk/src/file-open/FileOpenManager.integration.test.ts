import "reflect-metadata";
import type { RuntimeAppManifest, RuntimeDlcManifest } from "@edenapp/types";
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

  it("exposes DLC file handlers through their host only while installed", async () => {
    eden = await createTestEden();
    const registry = eden.runtime.resolve(PackageRegistry);
    const editor = {
      kind: "app",
      id: "com.example.editor",
      name: "Editor",
      version: "1.0.0",
      frontend: { entry: "index.html" },
      isPrebuilt: false,
      isDevelopment: false,
      isCore: false,
      isRestricted: false,
      resolvedGrants: [],
    } as RuntimeAppManifest;
    const highlighter = {
      kind: "dlc",
      id: "com.example.editor.http",
      name: "HTTP support",
      version: "1.0.0",
      hostAppId: editor.id,
      fileHandlers: [
        {
          name: "HTTP request files",
          extensions: ["http", "rest"],
        },
      ],
      contributions: [{ extensionPoint: "languages", requires: "^1.0.0" }],
      isPrebuilt: false,
    } as RuntimeDlcManifest;
    registry.register(editor);
    registry.register(highlighter);

    const user = await eden.runtime.users.create({
      username: "editor-user",
      name: "Editor User",
      password: "password",
    });
    await eden.runtime.sessions.login(user.username, "password");
    await eden.execute("fs/write", {
      path: "/request.http",
      content: "GET https://example.test",
    });

    await expect(
      eden.execute("file/get-supported-handlers", { path: "/request.http" }),
    ).resolves.toEqual([
      {
        appId: editor.id,
        appName: "Editor",
        handlerName: "HTTP request files",
        icon: undefined,
      },
    ]);

    registry.unregister(highlighter.id);
    await expect(
      eden.execute("file/get-supported-handlers", { path: "/request.http" }),
    ).resolves.toEqual([]);
  });
});
