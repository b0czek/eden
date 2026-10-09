import "reflect-metadata";
import { statSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type {
  FilesystemVolume,
  OperationHandle,
  RuntimeAppManifest,
  UserProfile,
} from "@edenapp/types";
import { PermissionRegistry } from "../ipc";
import { OperationManager } from "../operations/OperationManager";
import { PackageRegistry } from "../package-manager/PackageRegistry";
import { ProcessManager } from "../process-manager/ProcessManager";
import { createTestEden, type TestEden } from "../testing/createTestEden";
import { decodeLaunchContext } from "../utils/appLaunchContext";
import { ViewManager } from "../view-manager/ViewManager";
import { FilesystemTransfer } from "./FilesystemTransfer";
import { VolumeManager } from "./VolumeManager";

const appId = "com.example.volumes";

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected an active resource");
  return value;
}

describe("consumer-managed filesystem volumes", () => {
  let eden: TestEden;
  let usbRoot: string;
  let user: UserProfile;

  beforeEach(async () => {
    eden = await createTestEden();
    user = await eden.runtime.users.create({
      username: "operator",
      name: "Operator",
      password: "password",
      homeDirectory: "operators/one",
      grants: ["*"],
    });
    await eden.runtime.sessions.login(user.username, "password");
    eden.runtime
      .resolve(PermissionRegistry)
      .registerApp(appId, ["fs/*", "volume/*"]);
    usbRoot = path.join(eden.paths.root, "usb");
    await fs.mkdir(usbRoot);
    await eden.runtime.volumes.register({
      id: "usb",
      label: "Thumb drive",
      kind: "removable",
      rootPath: usbRoot,
    });
  });

  afterEach(async () => {
    await eden?.dispose();
  });

  const execute = <T = unknown>(command: string, args: unknown = {}) =>
    eden.complete<T>(command, args, {
      appId,
      principal: { kind: "user", profile: user },
    });

  it("publishes detached metadata without revealing mount paths", async () => {
    const changes: FilesystemVolume[][] = [];
    const stop = eden.runtime.volumes.onChanged((volumes) =>
      changes.push(volumes),
    );
    const mount = path.join(eden.paths.root, "network");
    await fs.mkdir(mount);
    await eden.runtime.volumes.register({
      id: "network",
      label: "Mounted share",
      kind: "network",
      rootPath: mount,
    });
    const volumes = await execute<FilesystemVolume[]>("volume/list");
    expect(volumes.map((volume) => volume.id)).toEqual([
      "home",
      "usb",
      "network",
    ]);
    expect(volumes[2]).toEqual({
      id: "network",
      label: "Mounted share",
      kind: "network",
      readOnly: false,
      supportsWatch: false,
      supportsEject: false,
      state: "ready",
    });
    expect(volumes.some((volume) => "rootPath" in volume)).toBe(false);
    changes[0][0].label = "Changed";
    volumes[1].label = "Changed";
    expect(eden.runtime.volumes.list()[0].label).toBe("Home");
    expect(eden.runtime.volumes.list()[1].label).toBe("Thumb drive");
    stop();
    eden.runtime.volumes.unregister("network");
    expect(changes).toHaveLength(1);
  });

  it("authorizes volume discovery independently of file access", async () => {
    const permissions = eden.runtime.resolve(PermissionRegistry);
    permissions.registerApp(appId, ["fs/*"]);
    await expect(execute("volume/list")).rejects.toThrow("volume/read");
    await expect(
      execute("event/subscribe", { eventName: "volume/changed" }),
    ).rejects.toThrow("volume/read");

    permissions.registerApp(appId, ["volume/read"]);
    await expect(execute("volume/list")).resolves.toContainEqual(
      expect.objectContaining({ id: "usb" }),
    );
    await expect(
      execute("event/subscribe", { eventName: "volume/changed" }),
    ).resolves.toBeUndefined();
    await execute("event/unsubscribe", { eventName: "volume/changed" });
    await expect(
      execute("fs/readdir", { location: { volume: "usb", path: "/" } }),
    ).rejects.toThrow("fs/read");
  });

  it.each([
    ["volume/list", {}],
    ["volume/eject", { volume: "usb" }],
  ])("requires an execution principal for %s", async (command, args) => {
    await eden.runtime.sessions.logout();
    await expect(eden.execute(command, args)).rejects.toThrow(
      "Caller has no volume execution principal",
    );
    expect(eden.runtime.volumes.list()).toContainEqual(
      expect.objectContaining({ id: "usb", state: "ready" }),
    );
  });

  it("keeps home private while sharing registered volumes", async () => {
    await execute("fs/write", {
      location: { volume: "home", path: "/report.txt" },
      content: "private",
    });
    await execute("fs/write", {
      location: { volume: "usb", path: "/report.txt" },
      content: "shared",
    });
    const second = await eden.runtime.users.create({
      username: "second",
      name: "Second",
      password: "password",
      homeDirectory: "operators/two",
      grants: ["*"],
    });
    await expect(
      eden.complete(
        "fs/read",
        { location: { volume: "usb", path: "/report.txt" } },
        { appId, principal: { kind: "user", profile: second } },
      ),
    ).resolves.toBe("shared");
    await expect(
      eden.complete(
        "fs/exists",
        { location: { volume: "home", path: "/report.txt" } },
        { appId, principal: { kind: "user", profile: second } },
      ),
    ).resolves.toBe(false);
    await expect(
      fs.readFile(
        path.join(eden.paths.userDirectory, "operators/one/report.txt"),
        "utf8",
      ),
    ).resolves.toBe("private");
  });

  it("validates locations at filesystem and file-opening command boundaries", async () => {
    const location = { volume: "usb" };
    const validLocation = { volume: "usb", path: "/report.txt" };
    const requests: [string, unknown][] = [
      ...[
        "fs/read",
        "fs/read-binary",
        "fs/exists",
        "fs/mkdir",
        "fs/readdir",
        "fs/stat",
        "fs/watch",
        "fs/resolve",
        "fs/delete",
        "file/open",
        "file/get-handler",
        "file/remove-default-handler",
        "file/get-supported-handlers",
      ].map((command): [string, unknown] => [command, { location }]),
      ["fs/write", { location, content: "report" }],
      ["fs/write-binary", { location, content: new Uint8Array([1]) }],
      ["fs/search", { location, pattern: "report" }],
      ["file/open-with", { location, appId }],
      ["file/set-default-handler", { location, appId }],
      ["fs/cp", { from: location, to: validLocation }],
      ["fs/cp", { from: validLocation, to: location }],
      ["fs/mv", { from: location, to: validLocation }],
      ["fs/mv", { from: validLocation, to: location }],
    ];

    for (const [command, args] of requests) {
      await expect(execute(command, args)).rejects.toMatchObject({
        name: "ValiError",
        message: expect.stringContaining("requires volume and path"),
      });
    }
    await expect(fs.readdir(usbRoot)).resolves.toEqual([]);
  });

  it("rejects invalid command options without changing files", async () => {
    const location = { volume: "usb", path: "/report.txt" };
    const destination = { volume: "usb", path: "/copy.txt" };
    await execute("fs/write", { location, content: "original" });
    const requests: [string, unknown][] = [
      ["fs/write", { location, content: 1 }],
      ["fs/write-binary", { location, content: [1] }],
      ["fs/read", { location, encoding: "unsupported" }],
      ["fs/search", { location, pattern: 1 }],
      ["fs/search", { location, pattern: "report", limit: -1 }],
      ["fs/search", { location, pattern: "report", limit: 0.5 }],
      ["fs/unwatch", { watchId: 1 }],
      ["file/open-with", { location, appId: 1 }],
      ["file/set-default-handler", { location, appId: "" }],
      ["fs/cp", { from: location, to: destination, overwrite: "yes" }],
      ["fs/mv", { from: location, to: destination, overwrite: "yes" }],
    ];

    for (const [command, args] of requests) {
      await expect(execute(command, args)).rejects.toMatchObject({
        name: "ValiError",
      });
    }
    await expect(
      fs.readFile(path.join(usbRoot, "report.txt"), "utf8"),
    ).resolves.toBe("original");
    await expect(fs.readdir(usbRoot)).resolves.toEqual(["report.txt"]);
  });

  it("rejects missing volumes, invalid roots, and sandbox escapes", async () => {
    await expect(
      execute("fs/read", { volume: "usb", path: "/report.txt" }),
    ).rejects.toMatchObject({ name: "ValiError" });
    await expect(
      execute("fs/read", { location: { path: "/report.txt" } }),
    ).rejects.toThrow("requires volume and path");
    await expect(
      execute("fs/exists", {
        location: { volume: "absent", path: "/report.txt" },
      }),
    ).rejects.toThrow("unavailable");
    await expect(
      execute("fs/read", {
        location: { volume: "usb", path: "/../outside.txt" },
      }),
    ).rejects.toThrow("outside");
    await fs.symlink(eden.paths.userDirectory, path.join(usbRoot, "escape"));
    await expect(
      execute("fs/exists", {
        location: { volume: "usb", path: "/escape/report.txt" },
      }),
    ).rejects.toThrow("outside");
    await expect(
      execute("fs/write", {
        location: { volume: "usb", path: "/escape/report.txt" },
        content: "escape",
      }),
    ).rejects.toThrow("outside");
    await expect(
      execute("fs/delete", { location: { volume: "usb", path: "/" } }),
    ).rejects.toThrow("volume root");
    await expect(
      eden.runtime.volumes.register({
        id: "home",
        label: "Home",
        kind: "local",
        rootPath: usbRoot,
      }),
    ).rejects.toThrow("cannot be 'home'");
    await expect(
      eden.runtime.volumes.register({
        id: "usb",
        label: "Duplicate",
        kind: "local",
        rootPath: usbRoot,
      }),
    ).rejects.toThrow("already registered");
    const missingRoot = path.join(eden.paths.root, "missing-mount");
    await expect(
      eden.runtime.volumes.register({
        id: "missing",
        label: "Missing",
        kind: "local",
        rootPath: missingRoot,
      }),
    ).rejects.toThrow();
    await expect(fs.stat(missingRoot)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("returns false for dangling symlinks on an available volume", async () => {
    await fs.symlink("missing.txt", path.join(usbRoot, "dangling.txt"));

    await expect(
      execute("fs/exists", {
        location: { volume: "usb", path: "/dangling.txt" },
      }),
    ).resolves.toBe(false);
    await expect(
      execute("fs/exists", {
        location: { volume: "usb", path: "/missing.txt" },
      }),
    ).resolves.toBe(false);
  });

  it("enforces permissions and read-only status on both transfer ends", async () => {
    const root = path.join(eden.paths.root, "readonly");
    await fs.mkdir(root);
    await fs.writeFile(path.join(root, "report.txt"), "read-only source");
    await eden.runtime.volumes.register({
      id: "readonly",
      label: "Read-only",
      kind: "local",
      rootPath: root,
      readOnly: true,
    });
    const source = { volume: "readonly", path: "/report.txt" };
    const destination = { volume: "home", path: "/report.txt" };
    await execute("fs/cp", { from: source, to: destination });
    await expect(execute("fs/read", { location: destination })).resolves.toBe(
      "read-only source",
    );
    await expect(
      execute("fs/mv", {
        from: source,
        to: { volume: "home", path: "/moved.txt" },
      }),
    ).rejects.toThrow("read-only");
    await expect(
      execute("fs/cp", {
        from: destination,
        to: { volume: "readonly", path: "/copy.txt" },
      }),
    ).rejects.toThrow("read-only");
    await expect(
      execute("fs/write-binary", {
        location: { ...source },
        content: new Uint8Array([1]),
      }),
    ).rejects.toThrow("read-only");
    await expect(
      execute("fs/mkdir", {
        location: { volume: "readonly", path: "/folder" },
      }),
    ).rejects.toThrow("read-only");
    eden.runtime.resolve(PermissionRegistry).registerApp("reader", ["fs/read"]);
    await expect(
      eden.complete(
        "fs/write",
        { location: { volume: "usb", path: "/file" }, content: "denied" },
        { appId: "reader", principal: { kind: "user", profile: user } },
      ),
    ).rejects.toThrow("Permission denied");
  });

  it("copies and moves identical virtual paths across volumes", async () => {
    const home = { volume: "home", path: "/nested/report.txt" };
    const usb = { volume: "usb", path: "/nested/report.txt" };
    await execute("fs/write", { location: { ...home }, content: "report" });
    await execute("fs/cp", { from: home, to: usb });
    await expect(execute("fs/read", { location: usb })).resolves.toBe("report");
    await expect(
      execute("fs/search", {
        location: { volume: "usb", path: "/" },
        pattern: "report",
      }),
    ).resolves.toEqual([
      {
        location: { volume: "usb", path: "/nested/report.txt" },
        name: "report.txt",
        type: "file",
      },
    ]);
    await execute("fs/write", { location: { ...usb }, content: "updated" });
    await execute("fs/mv", { from: usb, to: home, overwrite: true });
    await expect(execute("fs/read", { location: home })).resolves.toBe(
      "updated",
    );
    await expect(execute("fs/exists", { location: usb })).resolves.toBe(false);
  });

  it.each(["copy", "move"] as const)(
    "restores an overwritten destination when the source disconnects during %s",
    async (operation) => {
      const source = path.join(usbRoot, "source.txt");
      const destinationRoot = path.join(
        eden.paths.userDirectory,
        requireValue(user.homeDirectory),
      );
      await fs.mkdir(destinationRoot, { recursive: true });
      const destination = path.join(destinationRoot, "original.txt");
      await fs.writeFile(source, "replacement");
      await fs.writeFile(destination, "original");
      const sourceLease = requireValue(
        eden.runtime.resolve(VolumeManager).getRoot("usb"),
      );
      const transfer = new FilesystemTransfer();
      await expect(
        transfer[operation]({
          source,
          destination,
          destinationLabel: "home:/original.txt",
          overwrite: true,
          assertSourceActive: async () => {
            // Disconnect after the original has been staged, before copying starts.
            if (
              (await fs.readdir(destinationRoot)).some((name) =>
                name.startsWith(".original.txt.eden-transfer-"),
              )
            ) {
              eden.runtime.volumes.unregister("usb");
            }
            await sourceLease.assertActive();
          },
          assertDestinationActive: async () => {
            await fs.stat(destinationRoot);
          },
        }),
      ).rejects.toThrow("unavailable");
      await expect(fs.readFile(destination, "utf8")).resolves.toBe("original");
      await expect(fs.readdir(destinationRoot)).resolves.toEqual([
        "original.txt",
      ]);
      await expect(fs.readFile(source, "utf8")).resolves.toBe("replacement");
    },
  );

  it.each(["file", "directory"] as const)(
    "preserves the target when copying an absolute link to a %s",
    async (kind) => {
      const target = path.join(usbRoot, "target");
      if (kind === "directory") await fs.mkdir(target);
      const contentPath = kind === "directory" ? "/report.txt" : "";
      await fs.writeFile(`${target}${contentPath}`, "linked report");
      await fs.symlink(target, path.join(usbRoot, "link"));

      for (const volume of ["usb", "home"]) {
        await execute("fs/cp", {
          from: { volume: "usb", path: "/link" },
          to: { volume, path: "/copy" },
        });
        const root =
          volume === "usb"
            ? usbRoot
            : path.join(
                eden.paths.userDirectory,
                requireValue(user.homeDirectory),
              );
        await expect(fs.readlink(path.join(root, "copy"))).resolves.toBe(
          target,
        );
        await expect(
          fs.readFile(`${path.join(root, "copy")}${contentPath}`, "utf8"),
        ).resolves.toBe("linked report");
        const read = execute("fs/read", {
          location: { volume, path: `/copy${contentPath}` },
        });
        if (volume === "usb") await expect(read).resolves.toBe("linked report");
        else await expect(read).rejects.toThrow("outside");
      }
    },
  );

  it("preserves relative and absolute link text inside a copied tree", async () => {
    const sourceRoot = path.join(usbRoot, "tree");
    await fs.mkdir(path.join(sourceRoot, "nested"), { recursive: true });
    await fs.writeFile(path.join(sourceRoot, "target.txt"), "linked report");
    await fs.symlink("target.txt", path.join(sourceRoot, "relative.txt"));
    await fs.symlink(
      "../target.txt",
      path.join(sourceRoot, "nested/relative.txt"),
    );
    await fs.symlink(
      path.join(sourceRoot, "target.txt"),
      path.join(sourceRoot, "absolute.txt"),
    );
    const externalTarget = path.join(usbRoot, "external.txt");
    await fs.writeFile(externalTarget, "external");
    await fs.symlink(externalTarget, path.join(sourceRoot, "external.txt"));
    await execute("fs/cp", {
      from: { volume: "usb", path: "/tree" },
      to: { volume: "home", path: "/copy" },
    });
    await fs.rm(sourceRoot, { recursive: true });
    const destinationRoot = path.join(
      eden.paths.userDirectory,
      requireValue(user.homeDirectory),
      "copy",
    );
    for (const link of ["relative.txt", "nested/relative.txt"]) {
      await expect(
        execute("fs/read", {
          location: { volume: "home", path: `/copy/${link}` },
        }),
      ).resolves.toBe("linked report");
    }
    await expect(
      fs.readlink(path.join(destinationRoot, "relative.txt")),
    ).resolves.toBe("target.txt");
    await expect(
      fs.readlink(path.join(destinationRoot, "nested/relative.txt")),
    ).resolves.toBe("../target.txt");
    await expect(
      fs.readlink(path.join(destinationRoot, "absolute.txt")),
    ).resolves.toBe(path.join(sourceRoot, "target.txt"));
    await expect(
      fs.readlink(path.join(destinationRoot, "external.txt")),
    ).resolves.toBe(externalTarget);
    await expect(
      execute("fs/read", {
        location: { volume: "home", path: "/copy/external.txt" },
      }),
    ).rejects.toThrow("outside");
  });

  it("passes complete addresses to stopped and running file handlers", async () => {
    const handlerId = "com.example.volume-handler";
    const handler = {
      kind: "app",
      id: handlerId,
      name: "Handler",
      version: "1.0.0",
      frontend: { entry: "index.html" },
      fileHandlers: [{ name: "Folders", directories: true }],
      isPrebuilt: false,
      isDevelopment: false,
      isCore: false,
      isRestricted: false,
      resolvedGrants: [],
    } as RuntimeAppManifest;
    eden.runtime.resolve(PackageRegistry).register(handler);
    await execute("fs/mkdir", {
      location: { volume: "usb", path: "/same-path" },
    });
    await execute("fs/mkdir", {
      location: { volume: "home", path: "/same-path" },
    });
    const usb = { volume: "usb", path: "/same-path" };
    await expect(execute("file/open", { location: usb })).resolves.toEqual({
      success: true,
      appId: handlerId,
    });
    const created = eden.platform.effects
      .filter((effect) => effect.type === "view-created")
      .at(-1);
    if (created?.type !== "view-created")
      throw new Error("Handler view was not created");
    expect(
      decodeLaunchContext(
        created.options.webPreferences?.additionalArguments ?? [],
      ),
    ).toEqual({ appId: handlerId, args: [], file: usb });
    const instance = requireValue(
      eden.runtime.resolve(ProcessManager).getAppInstance(handlerId),
    );
    const view = requireValue(
      eden.runtime.resolve(ViewManager).getViewInfo(instance.viewId),
    );
    await eden.platform.rendererIpc.invoke(
      "shell-command",
      view.view.webContents.id,
      "event/subscribe",
      { eventName: "file/opened" },
    );
    await expect(
      execute("file/open", {
        location: { volume: "home", path: "/same-path" },
      }),
    ).resolves.toEqual({ success: true, appId: handlerId });
    const messages = eden.platform.effects.flatMap((effect) =>
      effect.type === "message-sent" &&
      effect.webContentsId === view.view.webContents.id
        ? effect.args
        : [],
    );
    expect(messages).toContainEqual({
      type: "file/opened",
      payload: {
        location: { volume: "home", path: "/same-path" },
        isDirectory: true,
        appId: handlerId,
      },
    });
  });

  it("keeps picker selections within allowed, available volumes", async () => {
    const providerId = "com.example.volume-picker";
    const registry = eden.runtime.resolve(PackageRegistry);
    for (const id of [appId, providerId]) {
      registry.register({
        kind: "app",
        id,
        name: "Picker test",
        version: "1.0.0",
        frontend: { entry: "index.html" },
        isPrebuilt: false,
        isDevelopment: false,
        isCore: false,
        isRestricted: false,
        resolvedGrants: [],
      } as RuntimeAppManifest);
      await eden.complete("process/launch", { appId: id });
    }
    eden.runtime
      .resolve(PermissionRegistry)
      .registerApp(providerId, ["file-picker/display", "fs/read"]);
    const invoke = async (id: string, command: string, args: unknown) => {
      const instance = requireValue(
        eden.runtime.resolve(ProcessManager).getAppInstance(id),
      );
      const view = requireValue(
        eden.runtime.resolve(ViewManager).getViewInfo(instance.viewId),
      );
      const response = (await eden.platform.rendererIpc.invoke(
        "shell-command",
        view.view.webContents.id,
        command,
        args,
      )) as { mode: "result"; result: unknown };
      return response.result;
    };
    await invoke(providerId, "file-picker/register-display", {});
    const opened = (await invoke(appId, "file-picker/open", {
      mode: "open",
      multiple: true,
      allowedVolumes: ["home"],
    })) as { requestId: string };
    const resolve = (requestId: string, locations: unknown) =>
      invoke(providerId, "file-picker/resolve", {
        requestId,
        reason: "select",
        locations,
      });
    const home = { volume: "home", path: "/" };
    const usb = { volume: "usb", path: "/" };
    for (const locations of [undefined, null, {}, "home", []]) {
      await expect(resolve(opened.requestId, locations)).rejects.toThrow(
        "nonempty locations array",
      );
    }
    for (const location of [
      null,
      1,
      {},
      { volume: "home" },
      { volume: "", path: "/" },
    ]) {
      await expect(resolve(opened.requestId, [home, location])).rejects.toThrow(
        "Filesystem location requires volume and path",
      );
    }
    await expect(resolve(opened.requestId, [home, usb])).rejects.toThrow(
      "not allowed",
    );
    eden.runtime
      .resolve(PermissionRegistry)
      .registerApp(appId, ["fs/*", "file-picker/display"]);
    await expect(
      invoke(appId, "file-picker/resolve", {
        requestId: opened.requestId,
        reason: "select",
        locations: [home],
      }),
    ).rejects.toThrow("Only the display provider");
    await expect(
      resolve(opened.requestId, [home, { ...home, path: "/Documents" }]),
    ).resolves.toEqual({ success: true });

    const removable = (await invoke(appId, "file-picker/open", {
      mode: "open",
      multiple: true,
      initialLocation: usb,
    })) as { requestId: string };
    eden.runtime.volumes.unregister("usb");
    await expect(resolve(removable.requestId, [home, usb])).rejects.toThrow(
      "unavailable",
    );
    await invoke(providerId, "file-picker/resolve", {
      requestId: removable.requestId,
      reason: "cancel",
    });

    let enteredHost!: () => void;
    let rejectRemoval!: (error: Error) => void;
    const hostEntered = new Promise<void>((resolve) => {
      enteredHost = resolve;
    });
    await eden.runtime.volumes.register(
      {
        id: "usb",
        label: "Thumb drive",
        kind: "removable",
        rootPath: usbRoot,
      },
      {
        eject: () =>
          new Promise<void>((_resolve, reject) => {
            rejectRemoval = reject;
            enteredHost();
          }),
      },
    );
    const pending = (await invoke(appId, "file-picker/open", {
      mode: "open",
      initialLocation: usb,
    })) as { requestId: string };
    const removal = eden.runtime.volumes.eject("usb");
    await hostEntered;
    await expect(resolve(pending.requestId, [usb])).rejects.toThrow(
      "being removed",
    );
    rejectRemoval(new Error("Device busy"));
    await expect(removal).rejects.toThrow("Device busy");
    await expect(resolve(pending.requestId, [usb])).resolves.toEqual({
      success: true,
    });

    await eden.runtime.volumes.register({
      id: "readonly",
      label: "Read-only drive",
      kind: "removable",
      rootPath: usbRoot,
      readOnly: true,
    });
    const readonly = { volume: "readonly", path: "/" };
    const read = (await invoke(appId, "file-picker/open", {
      mode: "open",
      multiple: true,
    })) as { requestId: string };
    await expect(resolve(read.requestId, [home, readonly])).resolves.toEqual({
      success: true,
    });
    const save = (await invoke(appId, "file-picker/open", {
      mode: "save",
    })) as { requestId: string };
    await expect(resolve(save.requestId, [home, readonly])).rejects.toThrow(
      "read-only",
    );
    await expect(resolve(save.requestId, [home])).resolves.toEqual({
      success: true,
    });
  });

  const crossDeviceTest =
    statSync(os.tmpdir()).dev !== statSync(process.cwd()).dev ? it : it.skip;
  crossDeviceTest("moves across a real filesystem boundary", async () => {
    const otherRoot = await fs.mkdtemp(
      path.join(process.cwd(), ".eden-volume-test-"),
    );
    try {
      await eden.runtime.volumes.register({
        id: "other-device",
        label: "Other filesystem",
        kind: "local",
        rootPath: otherRoot,
      });
      const source = { volume: "home", path: "/cross-device/report.txt" };
      await execute("fs/write", {
        location: { ...source },
        content: "cross-device report",
      });
      const sourceRoot = path.join(
        eden.paths.userDirectory,
        requireValue(user.homeDirectory),
        "cross-device",
      );
      await fs.symlink("report.txt", path.join(sourceRoot, "relative.txt"));
      const from = { volume: "home", path: "/cross-device" };
      await execute("fs/mv", {
        from,
        to: { volume: "other-device", path: "/moved" },
      });
      for (const name of ["report.txt", "relative.txt"]) {
        await expect(
          execute("fs/read", {
            location: { volume: "other-device", path: `/moved/${name}` },
          }),
        ).resolves.toBe("cross-device report");
      }
      await expect(execute("fs/exists", { location: from })).resolves.toBe(
        false,
      );
    } finally {
      eden.runtime.volumes.unregister("other-device");
      await fs.rm(otherRoot, { recursive: true, force: true });
    }
  });

  const deletionFailureTest =
    statSync(os.tmpdir()).dev !== statSync(process.cwd()).dev &&
    process.getuid?.() !== 0
      ? it
      : it.skip;
  deletionFailureTest(
    "retains a completed cross-device copy when source deletion fails",
    async () => {
      const otherRoot = await fs.mkdtemp(
        path.join(process.cwd(), ".eden-volume-test-"),
      );
      const lockedDirectory = path.join(
        eden.paths.userDirectory,
        "operators/one/locked",
      );
      try {
        await eden.runtime.volumes.register({
          id: "other-device",
          label: "Other filesystem",
          kind: "local",
          rootPath: otherRoot,
        });
        const source = { volume: "home", path: "/locked/report.txt" };
        const destination = { volume: "other-device", path: "/report.txt" };
        await execute("fs/write", {
          location: { ...source },
          content: "preserve this copy",
        });
        await fs.chmod(lockedDirectory, 0o555);
        await expect(
          execute("fs/mv", { from: source, to: destination }),
        ).rejects.toThrow("could not completely remove the source");
        await expect(
          execute("fs/read", { location: destination }),
        ).resolves.toBe("preserve this copy");
        await expect(execute("fs/read", { location: source })).resolves.toBe(
          "preserve this copy",
        );
      } finally {
        await fs.chmod(lockedDirectory, 0o755);
        eden.runtime.volumes.unregister("other-device");
        await fs.rm(otherRoot, { recursive: true, force: true });
      }
    },
  );

  it("revokes old registrations and never recreates an absent mount", async () => {
    const lease = requireValue(
      eden.runtime.resolve(VolumeManager).getRoot("usb"),
    );
    expect(eden.runtime.volumes.unregister("usb")).toBe(true);
    await expect(
      execute("fs/exists", {
        location: { volume: "usb", path: "/report.txt" },
      }),
    ).rejects.toThrow("unavailable");
    await eden.runtime.volumes.register({
      id: "usb",
      label: "Reconnected",
      kind: "removable",
      rootPath: usbRoot,
    });
    await expect(lease.assertActive()).rejects.toThrow("unavailable");
    await fs.rename(usbRoot, `${usbRoot}-removed`);
    await expect(
      execute("fs/exists", {
        location: { volume: "usb", path: "/report.txt" },
      }),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      execute("fs/write", {
        location: { volume: "usb", path: "/nested/report.txt" },
        content: "never write here",
      }),
    ).rejects.toThrow();
    await expect(fs.stat(usbRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await fs.mkdir(usbRoot);
    await expect(
      execute("fs/write", {
        location: { volume: "usb", path: "/report.txt" },
        content: "wrong root",
      }),
    ).rejects.toThrow("mount has changed");
    await expect(fs.readdir(usbRoot)).resolves.toEqual([]);
  });

  it.each(["unplug", "eject"])(
    "invalidates owned watches and sends live volume inventory on %s",
    async (removal) => {
      const app = {
        kind: "app",
        id: appId,
        name: "Volumes",
        version: "1.0.0",
        frontend: { entry: "index.html" },
        isPrebuilt: false,
        isDevelopment: false,
        isCore: false,
        isRestricted: false,
        resolvedGrants: [],
      } as RuntimeAppManifest;
      eden.runtime.resolve(PackageRegistry).register(app);
      await eden.complete("process/launch", { appId });
      const instance = requireValue(
        eden.runtime.resolve(ProcessManager).getAppInstance(appId),
      );
      const view = requireValue(
        eden.runtime.resolve(ViewManager).getViewInfo(instance.viewId),
      );
      const webContentsId = view.view.webContents.id;
      const invoke = async (command: string, args: unknown) => {
        const response = (await eden.platform.rendererIpc.invoke(
          "shell-command",
          webContentsId,
          command,
          args,
        )) as
          | { mode: "operation"; handle: OperationHandle }
          | { mode: "result"; result: unknown };
        const result =
          response.mode === "operation" ? response.handle : response.result;
        return command === "volume/eject"
          ? eden.runtime
              .resolve(OperationManager)
              .wait(result as OperationHandle, {
                appId,
                principal: { kind: "user", profile: user },
              })
          : result;
      };
      await invoke("event/subscribe", { eventName: "fs/changed" });
      await invoke("event/subscribe", { eventName: "volume/changed" });
      if (removal === "eject") {
        eden.runtime.volumes.unregister("usb");
        await eden.runtime.volumes.register(
          {
            id: "usb",
            label: "USB",
            kind: "removable",
            rootPath: usbRoot,
          },
          {
            eject: async () => {
              // Native watches are released before the host's OS removal starts.
              await expect(
                invoke("fs/unwatch", { watchId: result.watchId }),
              ).rejects.toThrow("not owned");
            },
          },
        );
      }
      const result = (await invoke("fs/watch", {
        location: { volume: "usb", path: "/" },
      })) as {
        watchId: string;
      };
      if (removal === "eject") await invoke("volume/eject", { volume: "usb" });
      else eden.runtime.volumes.unregister("usb");
      const messages = eden.platform.effects.flatMap((effect) =>
        effect.type === "message-sent" && effect.webContentsId === webContentsId
          ? effect.args
          : [],
      );
      expect(messages).toContainEqual({
        type: "fs/changed",
        payload: { watchId: result.watchId, kind: "volume-removed" },
      });
      expect(messages).toContainEqual({
        type: "volume/changed",
        payload: { volumes: [expect.objectContaining({ id: "home" })] },
      });
      await expect(
        invoke("fs/unwatch", { watchId: result.watchId }),
      ).rejects.toThrow("not owned");
      await eden.runtime.volumes.register({
        id: "usb",
        label: "Mounted network share",
        kind: "network",
        rootPath: usbRoot,
      });
      await expect(
        invoke("fs/readdir", { location: { volume: "usb", path: "/" } }),
      ).resolves.toEqual([]);
      await expect(
        invoke("fs/watch", { location: { volume: "usb", path: "/" } }),
      ).rejects.toThrow("does not support watching");
    },
  );
});
