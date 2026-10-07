import "reflect-metadata";
import fs from "node:fs/promises";
import * as path from "node:path";
import type {
  OperationHandle,
  FilesystemVolume,
  UserProfile,
} from "@edenapp/types";
import type { EdenVolumeOptions } from "../api/ControlPlaneApi";
import { OperationManager } from "../operations/OperationManager";
import { PermissionRegistry } from "../ipc";
import { createTestEden, type TestEden } from "../testing/createTestEden";
import { VolumeManager } from "./VolumeManager";

const appId = "com.example.volume-removal";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("safe volume removal", () => {
  let eden: TestEden;
  let user: UserProfile;
  let usbRoot: string;

  beforeEach(async () => {
    eden = await createTestEden();
    user = await eden.runtime.users.create({
      username: "operator",
      name: "Operator",
      password: "password",
      grants: ["*"],
    });
    eden.runtime.resolve(PermissionRegistry).registerApp(appId, ["fs/*"]);
    usbRoot = path.join(eden.paths.root, "usb");
    await fs.mkdir(usbRoot);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await eden?.dispose();
  });

  const register = (operations: EdenVolumeOptions = {}, readOnly = false) =>
    eden.runtime.volumes.register(
      {
        id: "usb",
        label: "USB",
        kind: "removable",
        rootPath: usbRoot,
        readOnly,
      },
      operations,
    );
  const execute = <T = unknown>(command: string, args: unknown = {}) =>
    eden.complete<T>(command, args, {
      appId,
      principal: { kind: "user", profile: user },
    });

  it("drains volume work admitted at acceptance while its task is still queued", async () => {
    let hostContent: string | undefined;
    await register({
      eject: async () => {
        hostContent = await fs.readFile(
          path.join(usbRoot, "accepted.txt"),
          "utf8",
        );
      },
    });
    await fs.writeFile(
      path.join(eden.paths.userDirectory, "source.txt"),
      "queued work",
    );
    const caller = {
      appId,
      principal: { kind: "user" as const, profile: user },
    };
    const manager = eden.runtime.resolve(OperationManager);
    const copy = await eden.execute<OperationHandle>(
      "fs/cp",
      {
        from: { volume: "home", path: "/source.txt" },
        to: { volume: "usb", path: "/accepted.txt" },
      },
      caller,
    );
    expect(manager.get(copy, caller).status).toBe("queued");
    const eject = await eden.execute<OperationHandle>(
      "fs/eject",
      { volume: "usb" },
      caller,
    );
    expect(manager.get(copy, caller).status).toBe("queued");
    expect(
      eden.runtime.volumes.list().find((volume) => volume.id === "usb")?.state,
    ).toBe("ejecting");
    await manager.wait(copy, caller);
    await manager.wait(eject, caller);
    expect(hostContent).toBe("queued work");
  });

  it("keeps queued file-opening work admitted until its read handle closes", async () => {
    const closing = deferred();
    const finishClose = deferred();
    const filePath = path.join(usbRoot, "metadata.txt");
    await fs.writeFile(filePath, "File contents for MIME detection");
    let handle: fs.FileHandle | undefined;
    let hostCalls = 0;
    await register({
      eject: async () => {
        hostCalls++;
        expect(handle?.fd).toBe(-1);
      },
    });
    const open = fs.open.bind(fs);
    jest.spyOn(fs, "open").mockImplementation(async (...args) => {
      const opened = await open(...args);
      if (args[0] === filePath) {
        handle = opened;
        const close = opened.close.bind(opened);
        // Pause closure of a real descriptor; metadata detection and reads stay real.
        jest.spyOn(opened, "close").mockImplementation(async () => {
          closing.resolve();
          await finishClose.promise;
          await close();
        });
      }
      return opened;
    });
    const caller = {
      appId,
      principal: { kind: "user" as const, profile: user },
    };
    const manager = eden.runtime.resolve(OperationManager);
    try {
      const opening = await eden.execute<OperationHandle>(
        "file/open",
        {
          location: { volume: "usb", path: "/metadata.txt" },
        },
        caller,
      );
      expect(manager.get(opening, caller).status).toBe("queued");
      const ejecting = await eden.execute<OperationHandle>(
        "fs/eject",
        { volume: "usb" },
        caller,
      );
      await closing.promise;
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(handle!.fd).toBeGreaterThanOrEqual(0);
      expect(hostCalls).toBe(0);
      finishClose.resolve();
      // No handler is installed, but the real metadata read must finish safely.
      await expect(manager.wait(opening, caller)).resolves.toMatchObject({
        success: false,
      });
      await manager.wait(ejecting, caller);
      expect(hostCalls).toBe(1);
    } finally {
      finishClose.resolve();
    }
  });

  it("holds a volume lease through metadata lookup outside an operation", async () => {
    const closing = deferred();
    const finishClose = deferred();
    const filePath = path.join(usbRoot, "lookup.txt");
    await fs.writeFile(filePath, "Metadata lookup contents");
    let handle: fs.FileHandle | undefined;
    let hostCalls = 0;
    await register({
      eject: async () => {
        hostCalls++;
        expect(handle?.fd).toBe(-1);
      },
    });
    const open = fs.open.bind(fs);
    jest.spyOn(fs, "open").mockImplementation(async (...args) => {
      const opened = await open(...args);
      if (args[0] === filePath) {
        handle = opened;
        const close = opened.close.bind(opened);
        jest.spyOn(opened, "close").mockImplementation(async () => {
          closing.resolve();
          await finishClose.promise;
          await close();
        });
      }
      return opened;
    });
    try {
      const lookup = execute("file/get-handler", {
        location: { volume: "usb", path: "/lookup.txt" },
      });
      await closing.promise;
      const removal = execute("fs/eject", { volume: "usb" });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(handle!.fd).toBeGreaterThanOrEqual(0);
      expect(hostCalls).toBe(0);
      finishClose.resolve();
      await lookup;
      await removal;
      expect(hostCalls).toBe(1);
    } finally {
      finishClose.resolve();
    }
  });

  it("reserves eject on acceptance, retains failure, and allows an explicit retry", async () => {
    let busy = true;
    await register({
      eject: async () => {
        if (busy) throw new Error("Device is busy");
      },
    });
    const caller = {
      appId,
      principal: { kind: "user" as const, profile: user },
    };
    const manager = eden.runtime.resolve(OperationManager);
    const handle = await eden.execute<OperationHandle>(
      "fs/eject",
      { volume: "usb" },
      caller,
    );
    expect(manager.get(handle, caller).status).toBe("queued");
    expect(
      eden.runtime.volumes.list().find((volume) => volume.id === "usb")?.state,
    ).toBe("ejecting");
    await expect(
      execute("fs/read", { location: { volume: "usb", path: "/late.txt" } }),
    ).rejects.toThrow("ejecting");
    await expect(manager.wait(handle, caller)).rejects.toThrow(
      "Device is busy",
    );
    expect(manager.get(handle, caller)).toMatchObject({
      status: "failed",
      phase: "host-eject",
      error: { message: "Device is busy" },
    });
    expect(
      eden.runtime.volumes.list().find((volume) => volume.id === "usb")?.state,
    ).toBe("ready");
    busy = false;
    const retry = await eden.execute<OperationHandle>(
      "fs/eject",
      { volume: "usb" },
      caller,
    );
    expect(retry.id).not.toBe(handle.id);
    await manager.wait(retry, caller);
    expect(manager.get(retry, caller)).toMatchObject({ status: "succeeded" });
    expect(manager.get(handle, caller).status).toBe("failed");
  });

  it("keeps eject pending until the host confirms safe removal", async () => {
    const started = deferred();
    const finished = deferred();
    let calls = 0;
    await register({
      eject: async () => {
        calls++;
        started.resolve();
        await finished.promise;
      },
    });
    const inventories: FilesystemVolume[][] = [];
    eden.runtime.volumes.onChanged((volumes) => inventories.push(volumes));
    let completed = false;
    const removal = execute("fs/eject", { volume: "usb" }).then(() => {
      completed = true;
    });
    await started.promise;
    expect(completed).toBe(false);
    expect(await execute("fs/volumes")).toContainEqual({
      id: "usb",
      label: "USB",
      kind: "removable",
      readOnly: false,
      supportsWatch: true,
      supportsEject: true,
      state: "ejecting",
    });
    await expect(
      execute("fs/write", {
        location: { volume: "usb", path: "/late.txt" },
        content: "too late",
      }),
    ).rejects.toThrow("ejecting");
    await expect(
      execute("fs/readdir", {
        location: { volume: "usb", path: "/" },
      }),
    ).rejects.toThrow("ejecting");
    const duplicate = eden.runtime.volumes.eject("usb");
    await execute("fs/write", {
      location: { volume: "home", path: "/unrelated.txt" },
      content: "works",
    });
    finished.resolve();
    await Promise.all([removal, duplicate]);
    expect(completed).toBe(true);
    expect(calls).toBe(1);
    expect(
      inventories.map(
        (volumes) => volumes.find((volume) => volume.id === "usb")?.state,
      ),
    ).toEqual(["ejecting", undefined]);
    await expect(fs.stat(usbRoot)).resolves.toBeDefined();
    await expect(
      execute("fs/exists", { location: { volume: "usb", path: "/" } }),
    ).rejects.toThrow("unavailable");
  });

  it.each(["write", "cp", "mv"])(
    "finishes an admitted %s before the host removes the drive",
    async (command) => {
      const admitted = deferred();
      const resume = deferred();
      let hostContent: string | undefined;
      await register({
        eject: async () => {
          hostContent = await fs.readFile(
            path.join(usbRoot, "report.txt"),
            "utf8",
          );
        },
      });
      await fs.writeFile(
        path.join(eden.paths.userDirectory, "report.txt"),
        "complete report",
      );
      const manager = eden.runtime.resolve(VolumeManager);
      const getRoot = manager.getRoot.bind(manager);
      let paused = false;
      // Pause one real operation at its mount check to make the race deterministic.
      // The remaining permissions, path checks, transfer, and IO are production code.
      jest.spyOn(manager, "getRoot").mockImplementation((id) => {
        const root = getRoot(id);
        if (id !== "usb" || !root || paused) return root;
        paused = true;
        return {
          rootPath: root.rootPath,
          assertActive: async () => {
            admitted.resolve();
            await resume.promise;
            await root.assertActive();
          },
        };
      });
      const write = execute(
        `fs/${command}`,
        command === "write"
          ? {
              location: { volume: "usb", path: "/report.txt" },
              content: "complete report",
            }
          : {
              from: { volume: "home", path: "/report.txt" },
              to: { volume: "usb", path: "/report.txt" },
            },
      );
      await admitted.promise;
      const removal = eden.runtime.volumes.eject("usb");
      await expect(
        execute("fs/stat", {
          location: { volume: "usb", path: "/report.txt" },
        }),
      ).rejects.toThrow("ejecting");
      expect(hostContent).toBeUndefined();
      resume.resolve();
      await Promise.all([write, removal]);
      expect(hostContent).toBe("complete report");
      expect(eden.runtime.volumes.list().map((volume) => volume.id)).toEqual([
        "home",
      ]);
    },
  );

  it("restores access after host failure and allows retry", async () => {
    let busy = true;
    await register({
      eject: async () => {
        if (busy) throw new Error("Device is busy");
      },
    });
    const states: (string | undefined)[] = [];
    eden.runtime.volumes.onChanged((volumes) =>
      states.push(volumes.find((volume) => volume.id === "usb")?.state),
    );
    await expect(execute("fs/eject", { volume: "usb" })).rejects.toThrow(
      "Device is busy",
    );
    await execute("fs/write", {
      location: { volume: "usb", path: "/after-failure.txt" },
      content: "accessible",
    });
    await expect(
      fs.readFile(path.join(usbRoot, "after-failure.txt"), "utf8"),
    ).resolves.toBe("accessible");
    busy = false;
    await eden.runtime.volumes.eject("usb");
    expect(states).toEqual(["ejecting", "ready", "ejecting", undefined]);
  });

  it.each(["resolve", "reject"] as const)(
    "does not alter a reconnected drive when an earlier removal %ss",
    async (outcome) => {
      const started = deferred();
      const finished = deferred();
      await register({
        eject: async () => {
          started.resolve();
          await finished.promise;
        },
      });
      const removal = eden.runtime.volumes.eject("usb");
      // Attach the rejection handler before settling the host operation.
      const result =
        outcome === "resolve"
          ? expect(removal).resolves.toBeUndefined()
          : expect(removal).rejects.toThrow("old device failed");
      await started.promise;
      eden.runtime.volumes.unregister("usb");
      await register();
      if (outcome === "resolve") finished.resolve();
      else finished.reject(new Error("old device failed"));
      await result;
      expect(
        eden.runtime.volumes.list().find((volume) => volume.id === "usb"),
      ).toMatchObject({ state: "ready", supportsEject: false });
      await expect(
        execute("fs/readdir", { location: { volume: "usb", path: "/" } }),
      ).resolves.toEqual([]);
    },
  );

  it("ejects read-only volumes and does not turn unregister into an OS operation", async () => {
    let ejected = false;
    await register(
      {
        eject: async () => {
          ejected = true;
        },
      },
      true,
    );
    eden.runtime.volumes.unregister("usb");
    expect(ejected).toBe(false);
    await register(
      {
        eject: async () => {
          ejected = true;
        },
      },
      true,
    );
    await execute("fs/eject", { volume: "usb" });
    expect(ejected).toBe(true);
  });

  it("validates requests, capabilities, app permissions, and user grants", async () => {
    await register();
    await expect(execute("fs/eject", { volume: "home" })).rejects.toThrow(
      "home volume",
    );
    await expect(execute("fs/eject", { volume: "missing" })).rejects.toThrow(
      "unavailable",
    );
    await expect(execute("fs/eject", { volume: "usb" })).rejects.toThrow(
      "does not support",
    );
    for (const args of [{}, { volume: "" }, { volume: 1 }])
      await expect(execute("fs/eject", args)).rejects.toMatchObject({
        name: "ValiError",
      });
    eden.runtime.volumes.unregister("usb");
    await register({ eject: async () => {} });
    eden.runtime
      .resolve(PermissionRegistry)
      .registerApp(appId, ["fs/read", "fs/write"]);
    await expect(execute("fs/eject", { volume: "usb" })).rejects.toThrow(
      "Permission denied",
    );
    eden.runtime.resolve(PermissionRegistry).registerApp(
      appId,
      ["fs/read", "fs/write"],
      [
        {
          id: "remove-volume",
          label: "Remove volumes",
          scope: "app",
          permissions: ["fs/eject"],
        },
      ],
    );
    user = { ...user, grants: [] };
    await expect(execute("fs/eject", { volume: "usb" })).rejects.toThrow(
      "Grant denied",
    );
    expect(
      eden.runtime.volumes.list().find((volume) => volume.id === "usb")?.state,
    ).toBe("ready");
  });

  it("does not invoke the host operation on a replaced mount", async () => {
    let ejected = false;
    await register({
      eject: async () => {
        ejected = true;
      },
    });
    await fs.rename(usbRoot, `${usbRoot}-old`);
    await fs.mkdir(usbRoot);
    await expect(eden.runtime.volumes.eject("usb")).rejects.toThrow(
      "mount has changed",
    );
    expect(ejected).toBe(false);
  });
});
