import "reflect-metadata";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  FilesystemHandle,
  OperationHandle,
  RuntimeAppManifest,
} from "@edenapp/types";
import type { CommandCallerContext } from "../execution/ExecutionContext";
import { PermissionRegistry } from "../ipc";
import { OperationManager } from "../operations/OperationManager";
import { PackageRegistry } from "../package-manager/PackageRegistry";
import { BackendManager } from "../process-manager/BackendManager";
import { ProcessManager } from "../process-manager/ProcessManager";
import { createTestEden, type TestEden } from "../testing/createTestEden";
import { ViewManager } from "../view-manager/ViewManager";

describe("file handle access and lifetime", () => {
  let eden: TestEden;
  let caller: CommandCallerContext;
  let root: string;
  const location = { volume: "usb", path: "/part.txt" };
  const appId = "com.example.file-handles";
  let ejected: boolean;

  const execute = <T = unknown>(
    command: string,
    args: unknown,
    owner = caller,
  ) => eden.complete<T>(command, args, owner);

  beforeEach(async () => {
    eden = await createTestEden();
    const user = await eden.runtime.users.create({
      username: "operator",
      name: "Operator",
      password: "password",
      grants: ["*"],
    });
    await eden.runtime.sessions.login("operator", "password");
    caller = {
      appId,
      principal: { kind: "user", profile: user },
      sessionId: "file-session",
    };
    eden.runtime
      .resolve(PermissionRegistry)
      .registerApp(appId, ["fs/read", "volume/*"]);
    root = path.join(eden.paths.root, "usb");
    await fs.mkdir(root);
    await fs.writeFile(path.join(root, "part.txt"), "original");
    ejected = false;
    await eden.runtime.volumes.register(
      { id: "usb", label: "USB", kind: "removable", rootPath: root },
      {
        eject: async () => {
          ejected = true;
        },
      },
    );
  });

  afterEach(async () => {
    await eden?.dispose();
  });

  it("accepts enriched locations for one-shot reads and file or directory metadata", async () => {
    const enriched = { ...location, label: "Program", selected: true };
    expect(await execute("fs/read", { location: enriched })).toBe("original");
    expect(await execute("fs/read-binary", { location: enriched })).toEqual(
      new Uint8Array(Buffer.from("original")),
    );
    expect(await execute("fs/stat", { location: enriched })).toMatchObject({
      isFile: true,
      size: 8,
    });
    expect(
      await execute("fs/stat", {
        location: { volume: "usb", path: "/", label: "Drive" },
      }),
    ).toMatchObject({ isDirectory: true });
  });

  it("pins the opened file across replacement while one-shot reads follow the location", async () => {
    const handle = await execute<FilesystemHandle>("fs/open", { location });
    await fs.rename(path.join(root, "part.txt"), path.join(root, "old.txt"));
    await fs.writeFile(path.join(root, "part.txt"), "replacement content");
    await fs.unlink(path.join(root, "old.txt"));
    expect(await execute("fs/read", { location: handle })).toBe("original");
    expect(await execute("fs/stat", { location: handle })).toMatchObject({
      isFile: true,
      size: 8,
    });
    expect(await execute("fs/read", { location })).toBe("replacement content");
    await execute("fs/close", { handle });
    await expect(execute("fs/read", { location: handle })).rejects.toThrow(
      /unavailable/,
    );
  });

  it("returns the complete file on repeated and concurrent reads without a shared cursor", async () => {
    const contents = Buffer.alloc(150_001, 0xa5);
    contents[0] = 0;
    contents[150_000] = 0xff;
    await fs.writeFile(path.join(root, "part.txt"), contents);
    const handle = await execute<FilesystemHandle>("fs/open", {
      location,
      mode: "read",
    });
    const reads = await Promise.all([
      execute("fs/read-binary", { location: handle }),
      execute("fs/read-binary", { location: handle }),
    ]);
    for (const read of reads) expect(read).toEqual(new Uint8Array(contents));
    expect(
      await execute("fs/read", { location: handle, encoding: "hex" }),
    ).toBe(contents.toString("hex"));
    const acceptedRead = execute("fs/read-binary", { location: handle });
    const closing = execute("fs/close", { handle });
    expect(await acceptedRead).toEqual(new Uint8Array(contents));
    await closing;
  });

  it("binds handle access and close to the opening app, account, and session", async () => {
    const handle = await execute<FilesystemHandle>("fs/open", { location });
    const otherUser = await eden.runtime.users.create({
      username: "other",
      name: "Other",
      password: "password",
      grants: ["*"],
    });
    eden.runtime
      .resolve(PermissionRegistry)
      .registerApp("com.example.other", ["fs/read"]);
    const outsiders: CommandCallerContext[] = [
      { ...caller, appId: "com.example.other" },
      { ...caller, sessionId: "new-session" },
      { ...caller, principal: { kind: "user", profile: otherUser } },
    ];
    for (const owner of outsiders) {
      await expect(
        execute("fs/read-binary", { location: handle }, owner),
      ).rejects.toThrow(/unavailable/);
      await expect(
        execute("fs/stat", { location: handle }, owner),
      ).rejects.toThrow(/unavailable/);
      await expect(execute("fs/close", { handle }, owner)).rejects.toThrow(
        /unavailable/,
      );
    }
    expect(await execute("fs/read", { location: handle })).toBe("original");
    await expect(
      execute("fs/stat", {
        location: { handleId: handle.handleId, ...location },
      }),
    ).rejects.toThrow();
    await execute("fs/close", { handle });
  });

  it("keeps admitted handles readable during eject and releases the drive on close", async () => {
    const handle = await execute<FilesystemHandle>("fs/open", { location });
    const eject = await eden.execute<OperationHandle>(
      "volume/eject",
      { volume: "usb" },
      caller,
    );
    expect(
      eden.runtime.volumes.list().find((volume) => volume.id === "usb")?.state,
    ).toBe("ejecting");
    await expect(execute("fs/open", { location })).rejects.toThrow(/ejecting/);
    await expect(execute("fs/read", { location })).rejects.toThrow(/ejecting/);
    expect(await execute("fs/read", { location: handle })).toBe("original");
    expect(ejected).toBe(false);
    await execute("fs/close", { handle });
    await eden.runtime.resolve(OperationManager).wait(eject, caller);
    expect(ejected).toBe(true);
  });

  it("releases admission after a failed open and after a one-shot read", async () => {
    await expect(
      execute("fs/open", { location: { ...location, path: "/missing" } }),
    ).rejects.toThrow();
    await expect(
      execute("fs/open", { location: { ...location, path: "/" } }),
    ).rejects.toThrow(/regular file/);
    await expect(
      execute("fs/open", { location: { ...location, path: "../outside" } }),
    ).rejects.toThrow(/outside/);
    expect(await execute("fs/read", { location })).toBe("original");
    await execute("volume/eject", { volume: "usb" });
    expect(ejected).toBe(true);
  });

  it("rejects handle reads after physical removal instead of using a reconnected volume", async () => {
    const handle = await execute<FilesystemHandle>("fs/open", { location });
    eden.runtime.volumes.unregister("usb");
    await eden.runtime.volumes.register({
      id: "usb",
      label: "Reconnected",
      kind: "removable",
      rootPath: root,
    });
    await expect(execute("fs/read", { location: handle })).rejects.toThrow(
      /unavailable/,
    );
    await execute("fs/close", { handle });
  });

  async function launchOwner(backend = false): Promise<void> {
    eden.runtime
      .resolve(PermissionRegistry)
      .registerApp(appId, ["fs/read", "volume/*", "process/manage"]);
    eden.runtime.resolve(PackageRegistry).register({
      kind: "app",
      id: appId,
      name: "File Handles",
      version: "1.0.0",
      ...(backend
        ? { backend: { entry: "backend.js" } }
        : { frontend: { entry: "index.html" } }),
      window: {
        mode: "floating",
        injections: { appFrame: "none", css: "none" },
      },
      isPrebuilt: false,
      isDevelopment: false,
      isCore: false,
      isRestricted: false,
      resolvedGrants: [],
    } as RuntimeAppManifest);
    const launching = execute("process/launch", { appId });
    if (backend) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      const process = eden.runtime.resolve(BackendManager).getBackend(appId);
      if (!process?.pid) throw new Error("Backend did not start");
      const simulated = eden.platform.utilityProcesses.get(process.pid);
      if (!simulated) throw new Error("Backend process is unavailable");
      simulated.emit("message", { type: "backend-ready" });
    }
    await launching;
  }

  it("closes frontend handles when their view is removed", async () => {
    await launchOwner();
    const instance = eden.runtime.resolve(ProcessManager).getAppInstance(appId);
    if (!instance) throw new Error("Owner app is unavailable");
    const views = eden.runtime.resolve(ViewManager);
    const view = views.getViewInfo(instance.viewId);
    if (!view) throw new Error("Owner view is unavailable");
    const owner = { ...caller, webContentsId: view.view.webContents.id };
    const handle = await execute<FilesystemHandle>(
      "fs/open",
      { location },
      owner,
    );
    views.removeView(instance.viewId);
    await expect(
      execute("fs/read", { location: handle }, owner),
    ).rejects.toThrow(/unavailable/);
    await execute("volume/eject", { volume: "usb" });
    expect(ejected).toBe(true);
  });

  it("closes backend handles when their app stops", async () => {
    await launchOwner(true);
    const handle = await execute<FilesystemHandle>("fs/open", { location });
    await execute("process/stop", { appId });
    await expect(execute("fs/read", { location: handle })).rejects.toThrow(
      /unavailable/,
    );
    await execute("volume/eject", { volume: "usb" });
    expect(ejected).toBe(true);
  });

  it("closes backend handles after an unexpected process exit", async () => {
    await launchOwner(true);
    const handle = await execute<FilesystemHandle>("fs/open", { location });
    const backend = eden.runtime.resolve(BackendManager).getBackend(appId);
    if (!backend) throw new Error("Owner backend is unavailable");
    backend.kill();
    await expect(execute("fs/read", { location: handle })).rejects.toThrow(
      /unavailable/,
    );
    await execute("volume/eject", { volume: "usb" });
    expect(ejected).toBe(true);
  });

  it("closes abandoned handles before draining an eject during runtime shutdown", async () => {
    await execute("fs/open", { location });
    await eden.execute("volume/eject", { volume: "usb" }, caller);
    await eden.runtime.dispose();
    expect(ejected).toBe(true);
  });
});
