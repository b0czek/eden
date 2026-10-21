import type { OperationHandle, RuntimeDlcManifest } from "@edenapp/types";
import { testApp } from "../../support/apps";
import { createTestEden, type TestEden } from "../../support/createTestEden";

describe("file opening integration", () => {
  let eden: TestEden;

  afterEach(async () => {
    await eden?.dispose();
  });

  it("encodes expected opening failures while retaining failure internally, and exposes defects as failures", async () => {
    eden = await createTestEden();
    const editor = testApp("test.editor", {
      fileHandlers: [{ name: "Text", extensions: ["txt"] }],
    });
    eden.runtime.services.installedPackages.register(editor);
    const user = await eden.runtime.effects.run(
      eden.runtime.users.create({
        username: "file-failures",
        name: "File Failures",
        password: "password",
      }),
    );
    await eden.runtime.effects.run(
      eden.runtime.sessions.login(user.username, "password"),
    );
    const location = { volume: "home", path: "/document.txt" };
    await eden.execute("fs/write", { location, content: "Document" });
    const operations = eden.runtime.services.operations;
    const caller = {
      sessionId: eden.runtime.services.sessionContext.getSessionId(),
    };
    const expected = await eden.execute<OperationHandle>("file/open-with", {
      location,
      appId: "missing.app",
    });
    await expect(
      eden.runtime.effects.run(operations.wait(expected, caller)),
    ).rejects.toThrow("App missing.app is not installed");
    expect(operations.get(expected, caller)).toMatchObject({
      status: "failed",
      response: { success: false, error: "App missing.app is not installed" },
    });

    await eden.complete("file/open", { location });
    const defect = new Error("Broken view focus");
    const show = jest
      .spyOn(eden.runtime.services.views, "showView")
      .mockImplementation(() => {
        throw defect;
      });
    try {
      const broken = await eden.execute<OperationHandle>("file/open", {
        location,
      });
      await expect(
        eden.runtime.effects.run(operations.wait(broken, caller)),
      ).rejects.toThrow("Broken view focus");
      const snapshot = operations.get(broken, caller);
      expect(snapshot).toMatchObject({
        status: "failed",
        error: { message: "Broken view focus" },
      });
      expect(snapshot).not.toHaveProperty("response");
    } finally {
      show.mockRestore();
    }
  });

  it("retains native metadata context through the operation and encodes its public failure", async () => {
    eden = await createTestEden();
    const user = await eden.runtime.effects.run(
      eden.runtime.users.create({
        username: "missing-file",
        name: "Missing File",
        password: "password",
      }),
    );
    await eden.runtime.effects.run(
      eden.runtime.sessions.login(user.username, "password"),
    );
    const location = { volume: "home", path: "/missing.txt" };
    const handle = await eden.execute<OperationHandle>("file/open", {
      location,
    });
    const operations = eden.runtime.services.operations;
    const caller = {
      sessionId: eden.runtime.services.sessionContext.getSessionId(),
    };
    await expect(
      eden.runtime.effects.run(operations.wait(handle, caller)),
    ).rejects.toMatchObject({
      _tag: "FileMetadataFailed",
      location,
      cause: { code: "ENOENT" },
    });
    expect(operations.get(handle, caller)).toMatchObject({
      status: "failed",
      response: { success: false, error: expect.stringContaining("ENOENT") },
    });
  });

  it("persists associations through commands and reports compatibility data", async () => {
    eden = await createTestEden();
    const filesApp = testApp("com.eden.files", {
      name: "Files",
      fileHandlers: [{ name: "Directories", directories: true }],
    });
    eden.runtime.services.installedPackages.register(filesApp);
    const user = await eden.runtime.effects.run(
      eden.runtime.users.create({
        username: "files-user",
        name: "Files User",
        password: "password",
      }),
    );
    await eden.runtime.effects.run(
      eden.runtime.sessions.login(user.username, "password"),
    );
    await eden.execute("fs/mkdir", {
      location: { path: "/Documents", volume: "home" },
    });

    await eden.execute("file/set-default-handler", {
      location: { path: "/Documents", volume: "home" },
      appId: filesApp.id,
    });

    await expect(
      eden.execute("file/get-handler", {
        location: { path: "/Documents", volume: "home" },
      }),
    ).resolves.toEqual({ appId: filesApp.id });
    await expect(eden.execute("file/get-associations")).resolves.toEqual({
      directory: { default: filesApp.id, userOverride: filesApp.id },
    });
    expect(eden.runtime.associations.get("file:directory")).toEqual({
      appId: filesApp.id,
      kind: "file.directory",
    });

    await eden.execute("file/remove-default-handler", {
      location: { path: "/Documents", volume: "home" },
    });
    expect(eden.runtime.associations.get("file:directory")).toBeUndefined();
  });

  it("exposes DLC file handlers through their host only while installed", async () => {
    eden = await createTestEden();
    const registry = eden.runtime.services.installedPackages;
    const editor = testApp("com.example.editor", { name: "Editor" });
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

    const user = await eden.runtime.effects.run(
      eden.runtime.users.create({
        username: "editor-user",
        name: "Editor User",
        password: "password",
      }),
    );
    await eden.runtime.effects.run(
      eden.runtime.sessions.login(user.username, "password"),
    );
    await eden.execute("fs/write", {
      location: { path: "/request.http", volume: "home" },
      content: "GET https://example.test",
    });

    await expect(
      eden.execute("file/get-supported-handlers", {
        location: { path: "/request.http", volume: "home" },
      }),
    ).resolves.toEqual([
      {
        appId: editor.id,
        appName: "Editor",
        handlerName: "HTTP request files",
        icon: undefined,
      },
    ]);
    await eden.execute("file/set-default-handler", {
      location: { path: "/request.http", volume: "home" },
      appId: editor.id,
    });
    await expect(
      eden.execute("file/get-handler", {
        location: { path: "/request.http", volume: "home" },
      }),
    ).resolves.toEqual({ appId: editor.id });

    registry.unregister(highlighter.id);
    await expect(
      eden.execute("file/get-supported-handlers", {
        location: { path: "/request.http", volume: "home" },
      }),
    ).resolves.toEqual([]);
    await expect(
      eden.execute("file/get-handler", {
        location: { path: "/request.http", volume: "home" },
      }),
    ).resolves.toEqual({ appId: undefined });
  });

  it("uses current locale and persisted associations when completing file opening", async () => {
    eden = await createTestEden();
    const registry = eden.runtime.services.installedPackages;
    const first = testApp("com.example.first", {
      name: { en: "First editor", pl: "Pierwszy edytor" },
      fileHandlers: [{ name: "Text", extensions: ["txt"] }],
    });
    const preferred = testApp("com.example.preferred", {
      name: { en: "Preferred editor", pl: "Wybrany edytor" },
      fileHandlers: [{ name: "Text", extensions: ["txt"] }],
    });
    registry.register(first);
    registry.register(preferred);
    const user = await eden.runtime.effects.run(
      eden.runtime.users.create({
        username: "localized-editor",
        name: "Localized Editor",
        password: "password",
      }),
    );
    await eden.runtime.effects.run(
      eden.runtime.sessions.login(user.username, "password"),
    );
    const location = { volume: "home", path: "/notes.txt" };
    await eden.execute("fs/write", { location, content: "Document contents" });
    await eden.execute("settings/set/su", {
      appId: "com.eden",
      key: "general.locale",
      value: "pl",
    });
    await expect(
      eden.execute("file/get-supported-handlers", { location }),
    ).resolves.toEqual([
      {
        appId: first.id,
        appName: "Pierwszy edytor",
        handlerName: "Text",
        icon: undefined,
      },
      {
        appId: preferred.id,
        appName: "Wybrany edytor",
        handlerName: "Text",
        icon: undefined,
      },
    ]);
    await eden.execute("file/set-default-handler", {
      location,
      appId: preferred.id,
    });
    await expect(eden.complete("file/open", { location })).resolves.toEqual({
      success: true,
      appId: preferred.id,
    });
    await eden.execute("file/remove-default-handler", { location });
    await expect(
      eden.execute("file/get-handler", { location }),
    ).resolves.toEqual({ appId: first.id });
    await eden.execute("settings/set/su", {
      appId: "com.eden",
      key: "general.locale",
      value: "en",
    });
    await expect(
      eden.execute("file/get-supported-handlers", { location }),
    ).resolves.toEqual([
      {
        appId: first.id,
        appName: "First editor",
        handlerName: "Text",
        icon: undefined,
      },
      {
        appId: preferred.id,
        appName: "Preferred editor",
        handlerName: "Text",
        icon: undefined,
      },
    ]);
  });
});
