import fs from "node:fs/promises";
import * as path from "node:path";
import type {
  FilesystemVolume,
  OperationHandle,
  UserProfile,
} from "@edenapp/types";
import * as Effect from "effect/Effect";
import type { EdenVolumeOptions } from "../../../src/api/control-plane";
import { createTestCaller } from "../../support/callers";
import { createTestEden, type TestEden } from "../../support/createTestEden";

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
    ({ user } = await createTestCaller(eden, appId, ["fs/*", "volume/*"]));
    usbRoot = path.join(eden.paths.root, "usb");
    await fs.mkdir(usbRoot);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await eden?.dispose();
  });

  const register = (operations: EdenVolumeOptions = {}, readOnly = false) =>
    eden.runtime.effects.run(
      eden.runtime.volumes.register(
        {
          id: "usb",
          label: "USB",
          kind: "removable",
          rootPath: usbRoot,
          readOnly,
        },
        operations,
      ),
    );
  const execute = <T = unknown>(command: string, args: unknown = {}) =>
    eden.complete<T>(command, args, {
      appId,
      principal: { kind: "user", profile: user },
    });

  it("drains volume work admitted at acceptance while its task is still queued", async () => {
    let hostContent: string | undefined;
    await register({
      eject: () =>
        Effect.promise(async () => {
          hostContent = await fs.readFile(
            path.join(usbRoot, "accepted.txt"),
            "utf8",
          );
        }),
    });
    await fs.writeFile(
      path.join(eden.paths.userDirectory, "source.txt"),
      "queued work",
    );
    const caller = {
      appId,
      principal: { kind: "user" as const, profile: user },
    };
    const filesystem = eden.runtime.services.operations;
    const copy = await eden.execute<OperationHandle>(
      "fs/cp",
      {
        from: { volume: "home", path: "/source.txt" },
        to: { volume: "usb", path: "/accepted.txt" },
      },
      caller,
    );
    expect(filesystem.get(copy, caller).status).toBe("queued");
    const eject = await eden.execute<OperationHandle>(
      "volume/eject",
      { volume: "usb" },
      caller,
    );
    expect(filesystem.get(copy, caller).status).toBe("queued");
    expect(
      eden.runtime.volumes.list().find((volume) => volume.id === "usb")?.state,
    ).toBe("ejecting");
    await eden.runtime.effects.run(filesystem.wait(copy, caller));
    await eden.runtime.effects.run(filesystem.wait(eject, caller));
    expect(hostContent).toBe("queued work");
  });

  it("retains queued child admission after the parent volume scope ends", async () => {
    let hostContent: string | undefined;
    await register({
      eject: () =>
        Effect.promise(async () => {
          hostContent = await fs.readFile(
            path.join(usbRoot, "child.txt"),
            "utf8",
          );
        }),
    });
    const runtime = eden.runtime;
    const { filesystem, volumes, execution, operations } = runtime.services;
    const caller = {
      appId,
      principal: { kind: "user" as const, profile: user },
    };
    const location = { volume: "usb", path: "/child.txt" };
    const prepared = await runtime.effects.run(
      execution.provide(
        volumes.withVolumes(
          ["usb"],
          Effect.sync(() =>
            filesystem.prepareVolumeOperation(["usb"], () =>
              filesystem.writeFile(location, "child work"),
            ),
          ),
        ),
        caller,
      ),
    );
    const child = operations.submit(
      "fs/write",
      { location, content: "child work" },
      caller,
      () => prepared,
    );
    const eject = await eden.execute<OperationHandle>(
      "volume/eject",
      { volume: "usb" },
      caller,
    );
    expect(operations.get(child, caller).status).toBe("queued");
    expect(hostContent).toBeUndefined();
    await runtime.effects.run(operations.wait(child, caller));
    await runtime.effects.run(operations.wait(eject, caller));
    expect(hostContent).toBe("child work");
  });

  it("releases a cancelled copy's destination while a conflicting copy is still blocked", async () => {
    const source = path.join(eden.paths.userDirectory, "source.txt");
    await fs.writeFile(source, "source contents");
    let ejected = false;
    await register({
      eject: () =>
        Effect.promise(async () => {
          ejected = true;
        }),
    });
    const copying = deferred();
    const resumeCopy = deferred();
    const stat = fs.stat.bind(fs);
    let pause = true;
    jest.spyOn(fs, "stat").mockImplementation(async (...args) => {
      if (args[0] === source && pause) {
        pause = false;
        copying.resolve();
        await resumeCopy.promise;
      }
      return stat(...args);
    });
    const caller = {
      appId,
      principal: { kind: "user" as const, profile: user },
    };
    const filesystem = eden.runtime.services.operations;
    const first = await eden.execute<OperationHandle>(
      "fs/cp",
      {
        from: { volume: "home", path: "/source.txt" },
        to: { volume: "home", path: "/first.txt" },
      },
      caller,
    );
    let firstFinished = false;
    const firstResult = eden.runtime.effects
      .run(filesystem.wait(first, caller))
      .then(() => {
        firstFinished = true;
      });
    // Release stalled I/O even if cancellation is broken, so failure can clean up.
    const watchdog = setTimeout(() => resumeCopy.resolve(), 2000);
    try {
      await copying.promise;
      const second = await eden.execute<OperationHandle>(
        "fs/cp",
        {
          from: { volume: "home", path: "/source.txt" },
          to: { volume: "usb", path: "/second.txt" },
        },
        caller,
      );
      await eden.execute("operation/cancel", { handle: second }, caller);
      const eject = await eden.execute<OperationHandle>(
        "volume/eject",
        { volume: "usb" },
        caller,
      );
      await expect(
        eden.runtime.effects.run(filesystem.wait(second, caller)),
      ).rejects.toMatchObject({
        name: "AbortError",
      });
      await eden.runtime.effects.run(filesystem.wait(eject, caller));
      expect(firstFinished).toBe(false);
      expect(ejected).toBe(true);
      expect(await fs.readdir(usbRoot)).toEqual([]);
    } finally {
      clearTimeout(watchdog);
      resumeCopy.resolve();
      await firstResult;
    }
  });

  it("keeps queued file-opening work admitted until its read handle closes", async () => {
    const closing = deferred();
    const finishClose = deferred();
    const filePath = path.join(usbRoot, "metadata.txt");
    await fs.writeFile(filePath, "File contents for MIME detection");
    let handle: fs.FileHandle | undefined;
    let hostCalls = 0;
    await register({
      eject: () =>
        Effect.promise(async () => {
          hostCalls++;
          expect(handle?.fd).toBe(-1);
        }),
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
    const filesystem = eden.runtime.services.operations;
    try {
      const opening = await eden.execute<OperationHandle>(
        "file/open",
        {
          location: { volume: "usb", path: "/metadata.txt" },
        },
        caller,
      );
      expect(filesystem.get(opening, caller).status).toBe("queued");
      const ejecting = await eden.execute<OperationHandle>(
        "volume/eject",
        { volume: "usb" },
        caller,
      );
      await closing.promise;
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(handle!.fd).toBeGreaterThanOrEqual(0);
      expect(hostCalls).toBe(0);
      finishClose.resolve();
      // No handler is installed, but the real metadata read must finish safely.
      await expect(
        eden.runtime.effects.run(filesystem.wait(opening, caller)),
      ).rejects.toThrow("No handler found");
      await eden.runtime.effects.run(filesystem.wait(ejecting, caller));
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
      eject: () =>
        Effect.promise(async () => {
          hostCalls++;
          expect(handle?.fd).toBe(-1);
        }),
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
      const removal = execute("volume/eject", { volume: "usb" });
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
      eject: () =>
        Effect.promise(async () => {
          if (busy) throw new Error("Device is busy");
        }),
    });
    const states: (string | undefined)[] = [];
    const stop = eden.runtime.volumes.onChanged((volumes) =>
      states.push(volumes.find((volume) => volume.id === "usb")?.state),
    );
    const caller = {
      appId,
      principal: { kind: "user" as const, profile: user },
    };
    const filesystem = eden.runtime.services.operations;
    const handle = await eden.execute<OperationHandle>(
      "volume/eject",
      { volume: "usb" },
      caller,
    );
    expect(filesystem.get(handle, caller).status).toBe("queued");
    expect(
      eden.runtime.volumes.list().find((volume) => volume.id === "usb")?.state,
    ).toBe("ejecting");
    await expect(
      execute("fs/read", { location: { volume: "usb", path: "/late.txt" } }),
    ).rejects.toThrow("ejecting");
    await expect(
      eden.runtime.effects.run(filesystem.wait(handle, caller)),
    ).rejects.toThrow("Device is busy");
    expect(filesystem.get(handle, caller)).toMatchObject({
      status: "failed",
      phase: "host-eject",
      error: { message: "Device is busy" },
    });
    expect(
      eden.runtime.volumes.list().find((volume) => volume.id === "usb")?.state,
    ).toBe("ready");
    await execute("fs/write", {
      location: { volume: "usb", path: "/after-failure.txt" },
      content: "accessible",
    });
    await expect(
      fs.readFile(path.join(usbRoot, "after-failure.txt"), "utf8"),
    ).resolves.toBe("accessible");
    busy = false;
    const retry = await eden.execute<OperationHandle>(
      "volume/eject",
      { volume: "usb" },
      caller,
    );
    expect(retry.id).not.toBe(handle.id);
    await eden.runtime.effects.run(filesystem.wait(retry, caller));
    expect(filesystem.get(retry, caller)).toMatchObject({
      status: "succeeded",
    });
    expect(filesystem.get(handle, caller).status).toBe("failed");
    expect(states).toEqual(["ejecting", "ready", "ejecting", undefined]);
    stop();
  });

  it("keeps eject pending until the host confirms safe removal", async () => {
    const started = deferred();
    const finished = deferred();
    let calls = 0;
    await register({
      eject: () =>
        Effect.promise(async () => {
          calls++;
          started.resolve();
          await finished.promise;
        }),
    });
    const inventories: FilesystemVolume[][] = [];
    eden.runtime.volumes.onChanged((volumes) => inventories.push(volumes));
    let completed = false;
    const removal = execute("volume/eject", { volume: "usb" }).then(() => {
      completed = true;
    });
    await started.promise;
    expect(completed).toBe(false);
    expect(await execute("volume/list")).toContainEqual({
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
    const duplicate = eden.runtime.effects.run(
      eden.runtime.volumes.eject("usb"),
    );
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
        eject: () =>
          Effect.promise(async () => {
            hostContent = await fs.readFile(
              path.join(usbRoot, "report.txt"),
              "utf8",
            );
          }),
      });
      await fs.writeFile(
        path.join(eden.paths.userDirectory, "report.txt"),
        "complete report",
      );
      const filesystem = eden.runtime.services.volumes;
      const getRoot = filesystem.root.bind(filesystem);
      let paused = false;
      // Pause one real operation at its mount check to make the race deterministic.
      // The remaining permissions, path checks, transfer, and IO are production code.
      jest.spyOn(filesystem, "root").mockImplementation((id) =>
        Effect.map(getRoot(id), (root) => {
          if (id !== "usb" || !root || paused) return root;
          paused = true;
          return {
            rootPath: root.rootPath,
            assertActive: () =>
              Effect.gen(function* () {
                admitted.resolve();
                yield* Effect.promise(() => resume.promise);
                yield* root.assertActive();
              }),
          };
        }),
      );
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
      const removal = eden.runtime.effects.run(
        eden.runtime.volumes.eject("usb"),
      );
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

  it.each(["resolve", "reject"] as const)(
    "does not alter a reconnected drive when an earlier removal %ss",
    async (outcome) => {
      const started = deferred();
      const finished = deferred();
      await register({
        eject: () =>
          Effect.promise(async () => {
            started.resolve();
            await finished.promise;
          }),
      });
      const removal = eden.runtime.effects.run(
        eden.runtime.volumes.eject("usb"),
      );
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
        eject: () =>
          Effect.promise(async () => {
            ejected = true;
          }),
      },
      true,
    );
    eden.runtime.volumes.unregister("usb");
    expect(ejected).toBe(false);
    await register(
      {
        eject: () =>
          Effect.promise(async () => {
            ejected = true;
          }),
      },
      true,
    );
    await execute("volume/eject", { volume: "usb" });
    expect(ejected).toBe(true);
  });

  it("validates requests, capabilities, app permissions, and user grants", async () => {
    await register();
    await expect(execute("volume/eject", { volume: "home" })).rejects.toThrow(
      "home volume",
    );
    await expect(
      execute("volume/eject", { volume: "missing" }),
    ).rejects.toThrow("unavailable");
    await expect(execute("volume/eject", { volume: "usb" })).rejects.toThrow(
      "does not support",
    );
    for (const args of [{}, { volume: "" }, { volume: 1 }])
      await expect(execute("volume/eject", args)).rejects.toMatchObject({
        name: "ValiError",
      });
    eden.runtime.volumes.unregister("usb");
    await register({ eject: () => Effect.promise(async () => {}) });
    eden.runtime.services.permissions.registerApp(appId, [
      "fs/read",
      "fs/write",
    ]);
    await expect(execute("volume/eject", { volume: "usb" })).rejects.toThrow(
      "Permission denied",
    );
    eden.runtime.services.permissions.registerApp(
      appId,
      ["fs/read", "fs/write"],
      [
        {
          id: "remove-volume",
          label: "Remove volumes",
          scope: "app",
          permissions: ["volume/eject"],
        },
      ],
    );
    user = { ...user, grants: [] };
    await expect(execute("volume/eject", { volume: "usb" })).rejects.toThrow(
      "Grant denied",
    );
    expect(
      eden.runtime.volumes.list().find((volume) => volume.id === "usb")?.state,
    ).toBe("ready");
  });

  it("does not invoke the host operation on a replaced mount", async () => {
    let ejected = false;
    await register({
      eject: () =>
        Effect.promise(async () => {
          ejected = true;
        }),
    });
    await fs.rename(usbRoot, `${usbRoot}-old`);
    await fs.mkdir(usbRoot);
    await expect(
      eden.runtime.effects.run(eden.runtime.volumes.eject("usb")),
    ).rejects.toThrow("mount has changed");
    expect(ejected).toBe(false);
  });
});
