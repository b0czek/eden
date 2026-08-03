import "reflect-metadata";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { RuntimeAppManifest, UserProfile } from "@edenapp/types";
import { AppRegistry } from "../app-registry/AppRegistry";
import { PermissionRegistry } from "../ipc";
import { ProcessManager } from "../process-manager/ProcessManager";
import { createTestEden, type TestEden } from "../testing/createTestEden";
import { ViewManager } from "../view-manager/ViewManager";

const caller = (appId: string, profile: UserProfile) => ({
  appId,
  principal: { kind: "user" as const, profile },
});

describe("FilesystemManager native watch integration", () => {
  let eden: TestEden;
  let profile: UserProfile;
  let webContentsId: number;
  const appId = "com.example.filesystem-watch";
  const otherAppId = "com.example.filesystem-watch-other";

  beforeEach(async () => {
    eden = await createTestEden();
    const manifest = {
      id: appId,
      name: "Filesystem Watch Test",
      version: "1.0.0",
      frontend: { entry: "index.html" },
      isPrebuilt: false,
      isDevelopment: false,
      isCore: false,
      isRestricted: false,
      resolvedGrants: [],
    } as RuntimeAppManifest;
    eden.runtime.resolve(AppRegistry).register(manifest);
    eden.runtime
      .resolve(PermissionRegistry)
      .registerApp(appId, ["fs/read", "fs/write"]);
    profile = await eden.runtime.users.create({
      username: "filesystem-watch-user",
      name: "Filesystem Watch User",
      password: "password",
      grants: [`apps/launch/${appId}`, `apps/launch/${otherAppId}`],
    });
    await eden.runtime.sessions.login(profile.username, "password");
    await eden.execute("process/launch", { appId });
    const instance = eden.runtime.resolve(ProcessManager).getAppInstance(appId);
    if (!instance) throw new Error("Filesystem test app was not launched");
    const viewInfo = eden.runtime
      .resolve(ViewManager)
      .getViewInfo(instance.viewId);
    if (!viewInfo) throw new Error("Filesystem test app view was not created");
    webContentsId = viewInfo.view.webContents.id;
    await invokeFromView("event/subscribe", { eventName: "fs/changed" });
  });

  afterEach(async () => {
    await eden?.dispose();
  });

  const invokeFromView = (command: string, args: unknown) =>
    eden.platform.rendererIpc.invoke(
      "shell-command",
      webContentsId,
      command,
      args,
    );

  const changeMessages = () =>
    eden.platform.effects.filter(
      (effect) =>
        effect.type === "message-sent" &&
        effect.webContentsId === webContentsId &&
        effect.channel === "shell-message",
    );

  const waitForChange = async (watchId: string) => {
    const deadline = Date.now() + 2_000;
    while (
      !changeMessages().some((effect) => {
        if (effect.type !== "message-sent") return false;
        const message = effect.args[0] as {
          type?: string;
          payload?: { watchId?: string; kind?: string };
        };
        return (
          message.type === "fs/changed" &&
          message.payload?.watchId === watchId &&
          message.payload.kind === "change"
        );
      }) &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(changeMessages()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          args: [
            {
              type: "fs/changed",
              payload: { watchId, kind: "change" },
            },
          ],
        }),
      ]),
    );
  };

  it("delivers real filesystem changes and stops after unwatch", async () => {
    const { watchId } = (await invokeFromView("fs/watch", { path: "/" })) as {
      watchId: string;
    };

    const expectChange = async (operation: () => Promise<void>) => {
      eden.platform.effects.splice(0);
      await operation();
      await waitForChange(watchId);
    };

    await expectChange(() =>
      fs.writeFile(path.join(eden.paths.userDirectory, "external.txt"), "a"),
    );
    await expectChange(() =>
      fs.writeFile(path.join(eden.paths.userDirectory, "external.txt"), "b"),
    );
    await expectChange(() =>
      fs.rename(
        path.join(eden.paths.userDirectory, "external.txt"),
        path.join(eden.paths.userDirectory, "renamed.txt"),
      ),
    );
    await expectChange(() =>
      fs.unlink(path.join(eden.paths.userDirectory, "renamed.txt")),
    );
    await expectChange(() =>
      invokeFromView("fs/write", {
        path: "/eden.txt",
        content: "internal",
      }).then(() => undefined),
    );

    await invokeFromView("fs/unwatch", { watchId });
    eden.platform.effects.splice(0);
    await fs.writeFile(
      path.join(eden.paths.userDirectory, "after-unwatch.txt"),
      "ignored",
    );
    await new Promise((resolve) => setTimeout(resolve, 180));
    expect(changeMessages()).toHaveLength(0);
  });

  it("rejects file targets and watches owned by another view", async () => {
    await fs.writeFile(
      path.join(eden.paths.userDirectory, "file.txt"),
      "content",
    );
    await expect(
      invokeFromView("fs/watch", { path: "/file.txt" }),
    ).rejects.toThrow("is not a directory");

    const { watchId } = (await invokeFromView("fs/watch", { path: "/" })) as {
      watchId: string;
    };
    eden.runtime.resolve(AppRegistry).register({
      id: otherAppId,
      name: "Other Filesystem Watch Test",
      version: "1.0.0",
      frontend: { entry: "index.html" },
      isPrebuilt: false,
      isDevelopment: false,
      isCore: false,
      isRestricted: false,
      resolvedGrants: [],
    } as RuntimeAppManifest);
    eden.runtime
      .resolve(PermissionRegistry)
      .registerApp(otherAppId, ["fs/read"]);
    await eden.execute("process/launch", { appId: otherAppId });
    const otherInstance = eden.runtime
      .resolve(ProcessManager)
      .getAppInstance(otherAppId);
    if (!otherInstance)
      throw new Error("Second filesystem test app was not launched");
    const otherViewInfo = eden.runtime
      .resolve(ViewManager)
      .getViewInfo(otherInstance.viewId);
    if (!otherViewInfo)
      throw new Error("Second filesystem test view was not created");

    await expect(
      eden.platform.rendererIpc.invoke(
        "shell-command",
        otherViewInfo.view.webContents.id,
        "fs/unwatch",
        { watchId },
      ),
    ).rejects.toThrow("not owned by the calling view");
  });

  it("refreshes watches for both directories after a cross-directory move", async () => {
    await invokeFromView("fs/mkdir", { path: "/source" });
    await invokeFromView("fs/mkdir", { path: "/destination" });
    await invokeFromView("fs/write", {
      path: "/source/item.txt",
      content: "moved",
    });
    const sourceWatch = (await invokeFromView("fs/watch", {
      path: "/source",
    })) as { watchId: string };
    const destinationWatch = (await invokeFromView("fs/watch", {
      path: "/destination",
    })) as { watchId: string };

    eden.platform.effects.splice(0);
    await invokeFromView("fs/mv", {
      from: "/source/item.txt",
      to: "/destination/item.txt",
    });

    await waitForChange(sourceWatch.watchId);
    await waitForChange(destinationWatch.watchId);
  });
});

describe("FilesystemManager integration", () => {
  let eden: TestEden;

  const setUpFilesystemCaller = async () => {
    eden = await createTestEden();
    const profile = await eden.runtime.users.create({
      username: "filesystem-transfer-user",
      name: "Filesystem Transfer User",
      password: "password",
    });
    eden.runtime
      .resolve(PermissionRegistry)
      .registerApp("filesystem-transfer-app", ["fs/write", "fs/read"]);
    return caller("filesystem-transfer-app", profile);
  };

  afterEach(async () => {
    await eden?.dispose();
  });

  it("enforces command permissions while using the real isolated root", async () => {
    eden = await createTestEden();
    const profile = await eden.runtime.users.create({
      username: "filesystem-user",
      name: "Filesystem User",
      password: "password",
    });
    const permissions = eden.runtime.resolve(PermissionRegistry);
    permissions.registerApp("authorized-app", ["fs/write", "fs/read"]);
    permissions.registerApp("unauthorized-app", ["fs/read"]);

    await eden.execute(
      "fs/write",
      { path: "/authorized.txt", content: "allowed" },
      caller("authorized-app", profile),
    );
    await expect(
      eden.execute(
        "fs/read",
        { path: "/authorized.txt" },
        caller("authorized-app", profile),
      ),
    ).resolves.toBe("allowed");
    await expect(
      eden.execute(
        "fs/resolve",
        { path: "/authorized.txt" },
        caller("authorized-app", profile),
      ),
    ).rejects.toThrow("Permission denied: fs/resolve");

    permissions.registerApp("authorized-app", [
      "fs/write",
      "fs/read",
      "fs/resolve",
    ]);
    await expect(
      eden.execute(
        "fs/resolve",
        { path: "/authorized.txt" },
        caller("authorized-app", profile),
      ),
    ).resolves.toEqual({
      realPath: `${eden.paths.userDirectory}/authorized.txt`,
    });
    await expect(
      eden.execute(
        "fs/write",
        { path: "/denied.txt", content: "blocked" },
        caller("unauthorized-app", profile),
      ),
    ).rejects.toThrow("Permission denied: fs/write");
    await expect(
      fs.access(`${eden.paths.userDirectory}/denied.txt`),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("copies and moves files and recursive directories", async () => {
    const transferCaller = await setUpFilesystemCaller();
    await eden.execute(
      "fs/write",
      { path: "/file.txt", content: "file contents" },
      transferCaller,
    );
    await eden.execute("fs/mkdir", { path: "/tree/nested" }, transferCaller);
    await eden.execute(
      "fs/write",
      { path: "/tree/nested/data.txt", content: "nested contents" },
      transferCaller,
    );

    await eden.execute(
      "fs/cp",
      { from: "/file.txt", to: "/copies/file.txt" },
      transferCaller,
    );
    await eden.execute(
      "fs/cp",
      { from: "/tree", to: "/copies/tree" },
      transferCaller,
    );
    await eden.execute(
      "fs/mv",
      { from: "/file.txt", to: "/moved/file.txt" },
      transferCaller,
    );
    await eden.execute(
      "fs/mv",
      { from: "/tree", to: "/moved/tree" },
      transferCaller,
    );

    await expect(
      fs.readFile(
        path.join(eden.paths.userDirectory, "copies", "file.txt"),
        "utf8",
      ),
    ).resolves.toBe("file contents");
    await expect(
      fs.readFile(
        path.join(
          eden.paths.userDirectory,
          "copies",
          "tree",
          "nested",
          "data.txt",
        ),
        "utf8",
      ),
    ).resolves.toBe("nested contents");
    await expect(
      fs.readFile(
        path.join(eden.paths.userDirectory, "moved", "file.txt"),
        "utf8",
      ),
    ).resolves.toBe("file contents");
    await expect(
      fs.readFile(
        path.join(
          eden.paths.userDirectory,
          "moved",
          "tree",
          "nested",
          "data.txt",
        ),
        "utf8",
      ),
    ).resolves.toBe("nested contents");
    await expect(
      fs.access(path.join(eden.paths.userDirectory, "file.txt")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      fs.access(path.join(eden.paths.userDirectory, "tree")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects existing targets unless replacement is explicit", async () => {
    const transferCaller = await setUpFilesystemCaller();
    await eden.execute(
      "fs/write",
      { path: "/copy-source.txt", content: "new copy" },
      transferCaller,
    );
    await eden.execute(
      "fs/write",
      { path: "/copy-target.txt", content: "old copy" },
      transferCaller,
    );
    await eden.execute(
      "fs/write",
      { path: "/move-source.txt", content: "new move" },
      transferCaller,
    );
    await eden.execute(
      "fs/write",
      { path: "/move-target.txt", content: "old move" },
      transferCaller,
    );

    await expect(
      eden.execute(
        "fs/cp",
        { from: "/copy-source.txt", to: "/copy-target.txt" },
        transferCaller,
      ),
    ).rejects.toThrow("already exists");
    await expect(
      eden.execute(
        "fs/mv",
        { from: "/move-source.txt", to: "/move-target.txt" },
        transferCaller,
      ),
    ).rejects.toThrow("already exists");
    await expect(
      fs.readFile(
        path.join(eden.paths.userDirectory, "copy-target.txt"),
        "utf8",
      ),
    ).resolves.toBe("old copy");
    await expect(
      fs.readFile(
        path.join(eden.paths.userDirectory, "move-target.txt"),
        "utf8",
      ),
    ).resolves.toBe("old move");

    await eden.execute(
      "fs/cp",
      {
        from: "/copy-source.txt",
        to: "/copy-target.txt",
        overwrite: true,
      },
      transferCaller,
    );
    await eden.execute(
      "fs/mv",
      {
        from: "/move-source.txt",
        to: "/move-target.txt",
        overwrite: true,
      },
      transferCaller,
    );

    await expect(
      fs.readFile(
        path.join(eden.paths.userDirectory, "copy-target.txt"),
        "utf8",
      ),
    ).resolves.toBe("new copy");
    await expect(
      fs.readFile(
        path.join(eden.paths.userDirectory, "move-target.txt"),
        "utf8",
      ),
    ).resolves.toBe("new move");
    await expect(
      fs.access(path.join(eden.paths.userDirectory, "move-source.txt")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("replaces complete directory targets without merging", async () => {
    const transferCaller = await setUpFilesystemCaller();
    await eden.execute("fs/mkdir", { path: "/source/nested" }, transferCaller);
    await eden.execute(
      "fs/write",
      { path: "/source/nested/new.txt", content: "new" },
      transferCaller,
    );
    await eden.execute("fs/mkdir", { path: "/target/stale" }, transferCaller);
    await eden.execute(
      "fs/write",
      { path: "/target/stale/old.txt", content: "old" },
      transferCaller,
    );

    await eden.execute(
      "fs/cp",
      { from: "/source", to: "/target", overwrite: true },
      transferCaller,
    );

    await expect(
      fs.readFile(
        path.join(eden.paths.userDirectory, "target", "nested", "new.txt"),
        "utf8",
      ),
    ).resolves.toBe("new");
    await expect(
      fs.access(
        path.join(eden.paths.userDirectory, "target", "stale", "old.txt"),
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.readdir(eden.paths.userDirectory)).resolves.not.toEqual(
      expect.arrayContaining([expect.stringContaining(".eden-transfer-")]),
    );
  });

  it("rejects same-path and descendant directory transfers", async () => {
    const transferCaller = await setUpFilesystemCaller();
    await eden.execute("fs/mkdir", { path: "/tree/child" }, transferCaller);
    await eden.execute(
      "fs/write",
      { path: "/tree/data.txt", content: "preserved" },
      transferCaller,
    );

    await expect(
      eden.execute("fs/cp", { from: "/tree", to: "/tree" }, transferCaller),
    ).rejects.toThrow("must be different");
    await expect(
      eden.execute("fs/mv", { from: "/tree", to: "/tree" }, transferCaller),
    ).rejects.toThrow("must be different");
    await expect(
      eden.execute(
        "fs/cp",
        { from: "/tree", to: "/tree/child/copy" },
        transferCaller,
      ),
    ).rejects.toThrow("descendant");
    await expect(
      eden.execute(
        "fs/mv",
        { from: "/tree", to: "/tree/child/moved" },
        transferCaller,
      ),
    ).rejects.toThrow("descendant");
    await expect(
      fs.readFile(path.join(eden.paths.userDirectory, "tree", "data.txt"), {
        encoding: "utf8",
      }),
    ).resolves.toBe("preserved");
  });
});
