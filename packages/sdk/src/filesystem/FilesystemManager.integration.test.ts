import "reflect-metadata";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { OperationManager } from "../operations/OperationManager";
import type {
  OperationHandle,
  RuntimeAppManifest,
  UserProfile,
} from "@edenapp/types";
import { PermissionRegistry } from "../ipc";
import { PackageRegistry } from "../package-manager/PackageRegistry";
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
      kind: "app",
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
    eden.runtime.resolve(PackageRegistry).register(manifest);
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

  const invokeFromView = async (command: string, args: unknown) => {
    const result = await eden.platform.rendererIpc.invoke(
      "shell-command",
      webContentsId,
      command,
      args,
    );
    return command === "fs/mv"
      ? eden.runtime
          .resolve(OperationManager)
          .wait(result as OperationHandle, caller(appId, profile))
      : result;
  };

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
    const { watchId } = (await invokeFromView("fs/watch", {
      location: { path: "/", volume: "home" },
    })) as {
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
        location: { path: "/eden.txt", volume: "home" },
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
      invokeFromView("fs/watch", {
        location: { path: "/file.txt", volume: "home" },
      }),
    ).rejects.toThrow("is not a directory");

    const { watchId } = (await invokeFromView("fs/watch", {
      location: { path: "/", volume: "home" },
    })) as {
      watchId: string;
    };
    eden.runtime.resolve(PackageRegistry).register({
      kind: "app",
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
    await invokeFromView("fs/mkdir", {
      location: { path: "/source", volume: "home" },
    });
    await invokeFromView("fs/mkdir", {
      location: { path: "/destination", volume: "home" },
    });
    await invokeFromView("fs/write", {
      location: { path: "/source/item.txt", volume: "home" },
      content: "moved",
    });
    const sourceWatch = (await invokeFromView("fs/watch", {
      location: { path: "/source", volume: "home" },
    })) as { watchId: string };
    const destinationWatch = (await invokeFromView("fs/watch", {
      location: { path: "/destination", volume: "home" },
    })) as { watchId: string };

    eden.platform.effects.splice(0);
    await invokeFromView("fs/mv", {
      from: { volume: "home", path: "/source/item.txt" },
      to: { volume: "home", path: "/destination/item.txt" },
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
      {
        location: { path: "/authorized.txt", volume: "home" },
        content: "allowed",
      },
      caller("authorized-app", profile),
    );
    await expect(
      eden.execute(
        "fs/read",
        { location: { path: "/authorized.txt", volume: "home" } },
        caller("authorized-app", profile),
      ),
    ).resolves.toBe("allowed");
    await expect(
      eden.execute(
        "fs/resolve",
        { location: { path: "/authorized.txt", volume: "home" } },
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
        { location: { path: "/authorized.txt", volume: "home" } },
        caller("authorized-app", profile),
      ),
    ).resolves.toEqual({
      realPath: `${eden.paths.userDirectory}/authorized.txt`,
    });
    await expect(
      eden.execute(
        "fs/write",
        {
          location: { path: "/denied.txt", volume: "home" },
          content: "blocked",
        },
        caller("unauthorized-app", profile),
      ),
    ).rejects.toThrow("Permission denied: fs/write");
    await expect(
      fs.access(`${eden.paths.userDirectory}/denied.txt`),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("round-trips binary files without text encoding", async () => {
    const transferCaller = await setUpFilesystemCaller();
    const content = new Uint8Array([0, 255, 128, 1, 13, 10, 0]);

    await eden.execute(
      "fs/write-binary",
      {
        location: { path: "/binary/nested/data.bin", volume: "home" },
        content,
      },
      transferCaller,
    );

    await expect(
      fs.readFile(
        path.join(eden.paths.userDirectory, "binary", "nested", "data.bin"),
      ),
    ).resolves.toEqual(Buffer.from(content));
    const result = await eden.execute<Uint8Array>(
      "fs/read-binary",
      { location: { path: "/binary/nested/data.bin", volume: "home" } },
      transferCaller,
    );
    expect(result).toBeInstanceOf(Uint8Array);
    expect([...result]).toEqual([...content]);
  });

  it("returns a copy handle before I/O and retains real completion phases and failures", async () => {
    const transferCaller = await setUpFilesystemCaller();
    const manager = eden.runtime.resolve(OperationManager);
    await eden.execute(
      "fs/write",
      {
        location: { volume: "home", path: "/operation-source" },
        content: "accepted",
      },
      transferCaller,
    );
    const phases: string[] = [];
    const off = manager.on("changed", ({ snapshot }) => {
      if (snapshot.phase) phases.push(snapshot.phase);
    });
    const args = {
      from: { volume: "home", path: "/operation-source" },
      to: { volume: "home", path: "/operation-destination" },
    };
    const handle = await eden.execute<OperationHandle>(
      "fs/cp",
      args,
      transferCaller,
    );
    expect(manager.get(handle, transferCaller).status).toBe("queued");
    await manager.wait(handle, transferCaller);
    expect(
      await fs.readFile(
        path.join(eden.paths.userDirectory, "operation-destination"),
        "utf8",
      ),
    ).toBe("accepted");
    expect(phases).toEqual(
      expect.arrayContaining(["validating", "preparing-copy", "copying"]),
    );
    const collision = await eden.execute<OperationHandle>(
      "fs/cp",
      args,
      transferCaller,
    );
    await expect(manager.wait(collision, transferCaller)).rejects.toThrow(
      "already exists",
    );
    expect(manager.get(collision, transferCaller)).toMatchObject({
      status: "failed",
      error: { message: expect.stringContaining("already exists") },
    });
    off();
  });

  it("copies and moves files and recursive directories", async () => {
    const transferCaller = await setUpFilesystemCaller();
    await eden.execute(
      "fs/write",
      {
        location: { path: "/file.txt", volume: "home" },
        content: "file contents",
      },
      transferCaller,
    );
    await eden.execute(
      "fs/mkdir",
      { location: { path: "/tree/nested", volume: "home" } },
      transferCaller,
    );
    await eden.execute(
      "fs/write",
      {
        location: { path: "/tree/nested/data.txt", volume: "home" },
        content: "nested contents",
      },
      transferCaller,
    );

    await eden.complete(
      "fs/cp",
      {
        from: { volume: "home", path: "/file.txt" },
        to: { volume: "home", path: "/copies/file.txt" },
      },
      transferCaller,
    );
    await eden.complete(
      "fs/cp",
      {
        from: { volume: "home", path: "/tree" },
        to: { volume: "home", path: "/copies/tree" },
      },
      transferCaller,
    );
    await eden.complete(
      "fs/mv",
      {
        from: { volume: "home", path: "/file.txt" },
        to: { volume: "home", path: "/moved/file.txt" },
      },
      transferCaller,
    );
    await eden.complete(
      "fs/mv",
      {
        from: { volume: "home", path: "/tree" },
        to: { volume: "home", path: "/moved/tree" },
      },
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
      {
        location: { path: "/copy-source.txt", volume: "home" },
        content: "new copy",
      },
      transferCaller,
    );
    await eden.execute(
      "fs/write",
      {
        location: { path: "/copy-target.txt", volume: "home" },
        content: "old copy",
      },
      transferCaller,
    );
    await eden.execute(
      "fs/write",
      {
        location: { path: "/move-source.txt", volume: "home" },
        content: "new move",
      },
      transferCaller,
    );
    await eden.execute(
      "fs/write",
      {
        location: { path: "/move-target.txt", volume: "home" },
        content: "old move",
      },
      transferCaller,
    );

    await expect(
      eden.complete(
        "fs/cp",
        {
          from: { volume: "home", path: "/copy-source.txt" },
          to: { volume: "home", path: "/copy-target.txt" },
        },
        transferCaller,
      ),
    ).rejects.toThrow("already exists");
    await expect(
      eden.complete(
        "fs/mv",
        {
          from: { volume: "home", path: "/move-source.txt" },
          to: { volume: "home", path: "/move-target.txt" },
        },
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

    await eden.complete(
      "fs/cp",
      {
        from: { volume: "home", path: "/copy-source.txt" },
        to: { volume: "home", path: "/copy-target.txt" },
        overwrite: true,
      },
      transferCaller,
    );
    await eden.complete(
      "fs/mv",
      {
        from: { volume: "home", path: "/move-source.txt" },
        to: { volume: "home", path: "/move-target.txt" },
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
    await eden.execute(
      "fs/mkdir",
      { location: { path: "/source/nested", volume: "home" } },
      transferCaller,
    );
    await eden.execute(
      "fs/write",
      {
        location: { path: "/source/nested/new.txt", volume: "home" },
        content: "new",
      },
      transferCaller,
    );
    await eden.execute(
      "fs/mkdir",
      { location: { path: "/target/stale", volume: "home" } },
      transferCaller,
    );
    await eden.execute(
      "fs/write",
      {
        location: { path: "/target/stale/old.txt", volume: "home" },
        content: "old",
      },
      transferCaller,
    );

    await eden.complete(
      "fs/cp",
      {
        from: { volume: "home", path: "/source" },
        to: { volume: "home", path: "/target" },
        overwrite: true,
      },
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
    await eden.execute(
      "fs/mkdir",
      { location: { path: "/tree/child", volume: "home" } },
      transferCaller,
    );
    await eden.execute(
      "fs/write",
      {
        location: { path: "/tree/data.txt", volume: "home" },
        content: "preserved",
      },
      transferCaller,
    );

    await expect(
      eden.complete(
        "fs/cp",
        {
          from: { volume: "home", path: "/tree" },
          to: { volume: "home", path: "/tree" },
        },
        transferCaller,
      ),
    ).rejects.toThrow("must be different");
    await expect(
      eden.complete(
        "fs/mv",
        {
          from: { volume: "home", path: "/tree" },
          to: { volume: "home", path: "/tree" },
        },
        transferCaller,
      ),
    ).rejects.toThrow("must be different");
    await expect(
      eden.complete(
        "fs/cp",
        {
          from: { volume: "home", path: "/tree" },
          to: { volume: "home", path: "/tree/child/copy" },
        },
        transferCaller,
      ),
    ).rejects.toThrow("descendant");
    await expect(
      eden.complete(
        "fs/mv",
        {
          from: { volume: "home", path: "/tree" },
          to: { volume: "home", path: "/tree/child/moved" },
        },
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
