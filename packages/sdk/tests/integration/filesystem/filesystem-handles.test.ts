import fs from "node:fs/promises";
import * as path from "node:path";
import type {
  FilesystemHandle,
  OperationHandle,
  RuntimeAppManifest,
} from "@edenapp/types";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import type { CommandCallerContext } from "../../../src/core/execution/context";
import { gate, tick } from "../../support/async";
import { createTestCaller } from "../../support/callers";
import { createTestEden, type TestEden } from "../../support/create-test-eden";
import { registerTestVolume } from "../../support/filesystem";

describe("file handle access and lifetime", () => {
  let eden: TestEden;
  let caller: CommandCallerContext;
  let root: string;
  const location = { volume: "usb", path: "/part.txt" };
  const appId = "com.example.file-handles";
  let ejected: boolean;
  let powerHandoffs: number;
  let powerFailure: Error | undefined;

  const execute = <T = unknown>(
    command: string,
    args: unknown,
    owner = caller,
  ) => eden.complete<T>(command, args, owner);

  beforeEach(async () => {
    powerHandoffs = 0;
    powerFailure = undefined;
    const handoff = () =>
      Effect.try({
        try: () => {
          powerHandoffs++;
          if (powerFailure) throw powerFailure;
        },
        catch: (error) =>
          error instanceof Error ? error : new Error(String(error)),
      });
    eden = await createTestEden({
      config: {
        powerProvider: {
          poweroff: handoff,
          reboot: handoff,
        },
      },
    });
    const { user, caller: owner } = await createTestCaller(eden, appId, [
      "fs/read",
      "volume/*",
    ]);
    await eden.runtime.effects.run(
      eden.runtime.sessions.login(user.username, "password"),
    );
    caller = { ...owner, sessionId: "file-session" };
    ejected = false;
    root = await registerTestVolume(
      eden,
      { id: "usb", label: "USB", kind: "removable" },
      {
        eject: () =>
          Effect.promise(async () => {
            ejected = true;
          }),
      },
    );
    await fs.writeFile(path.join(root, "part.txt"), "original");
  });

  afterEach(async () => {
    await eden?.dispose();
    jest.restoreAllMocks();
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

  it.each(["location", "handle"] as const)(
    "keeps a %s descriptor and volume admitted until interrupted native reads settle",
    async (kind) => {
      const reading = gate();
      const finishRead = gate();
      const nativeOpen = fs.open;
      let descriptor: fs.FileHandle | undefined;
      jest.spyOn(fs, "open").mockImplementation(async (...args) => {
        const file = await nativeOpen(...args);
        descriptor = file;
        const nativeRead = file.read.bind(file);
        jest.spyOn(file, "read").mockImplementation((async (
          ...args: unknown[]
        ) => {
          reading.release();
          await finishRead.promise;
          return Reflect.apply(nativeRead, undefined, args);
        }) as typeof file.read);
        return file;
      });
      const source =
        kind === "handle"
          ? await execute<FilesystemHandle>("fs/open", { location })
          : location;
      const runtime = eden.runtime;
      const fiber = runtime.effects.fork(
        runtime.services.execution.provide(
          runtime.services.filesystem.readBinaryFile(source),
          caller,
        ),
      );
      let closing = Promise.resolve();
      let removing = Promise.resolve();
      try {
        await reading.promise;
        fiber.interruptUnsafe();
        if ("handleId" in source)
          closing = execute<void>("fs/close", { handle: source });
        removing = eden.runtime.effects.run(eden.runtime.volumes.eject("usb"));
        await tick();
        expect(ejected).toBe(false);
        expect(fiber.pollUnsafe()).toBeUndefined();
        expect(await descriptor?.stat()).toMatchObject({ size: 8 });
        finishRead.release();
        const exit = await runtime.effects.run(Fiber.await(fiber));
        expect(
          Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause),
        ).toBe(true);
        await Promise.all([closing, removing]);
        expect(ejected).toBe(true);
        await expect(descriptor?.stat()).rejects.toMatchObject({
          code: "EBADF",
        });
      } finally {
        finishRead.release();
        await runtime.effects.run(Fiber.await(fiber));
        await Promise.allSettled([closing, removing]);
      }
    },
  );

  it("binds handle access and close to the opening app, account, and session", async () => {
    const handle = await execute<FilesystemHandle>("fs/open", { location });
    const otherUser = await eden.runtime.effects.run(
      eden.runtime.users.create({
        username: "other",
        name: "Other",
        password: "password",
        grants: ["*"],
      }),
    );
    eden.runtime.services.permissions.registerApp("com.example.other", [
      "fs/read",
    ]);
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
    await eden.runtime.effects.run(
      eden.runtime.services.operations.wait(eject, caller),
    );
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
    await eden.runtime.effects.run(
      eden.runtime.volumes.register({
        id: "usb",
        label: "Reconnected",
        kind: "removable",
        rootPath: root,
      }),
    );
    await expect(execute("fs/read", { location: handle })).rejects.toThrow(
      /unavailable/,
    );
    await execute("fs/close", { handle });
  });

  async function launchOwner(backend = false): Promise<void> {
    eden.runtime.services.permissions.registerApp(appId, [
      "fs/read",
      "volume/*",
      "process/manage",
    ]);
    eden.runtime.services.installedPackages.register({
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
      const simulated = eden.getBackendProcess(appId);
      simulated.emit("message", { type: "backend-ready" });
    }
    await launching;
  }

  it("closes frontend handles when their view is removed", async () => {
    await launchOwner();
    const views = eden.runtime.services.views;
    const view = eden.getAppView(appId);
    const owner = { ...caller, webContentsId: view.view.webContents.id };
    const handle = await execute<FilesystemHandle>(
      "fs/open",
      { location },
      owner,
    );
    await eden.runtime.effects.run(views.removeView(view.id));
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
    const backend = eden.runtime.services.backends.getBackend(appId);
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

  it.each(["operation", "host"] as const)(
    "releases session handles before logout drains an eject via %s",
    async (entry) => {
      caller.sessionId = eden.runtime.services.sessionContext.getSessionId();
      await launchOwner(true);
      await execute("fs/open", { location });
      const eject = await eden.execute<OperationHandle>(
        "volume/eject",
        { volume: "usb" },
        caller,
      );
      if (entry === "operation") await eden.complete("session/logout");
      else await eden.runtime.effects.run(eden.runtime.sessions.logout());
      await eden.runtime.effects.run(
        eden.runtime.services.operations.wait(eject, caller),
      );
      expect(ejected).toBe(true);
      expect(eden.runtime.sessions.current()).toBeNull();
      expect(
        eden.runtime.services.processes.getAppInstance(appId),
      ).toBeUndefined();
    },
  );

  it.each(["operation", "host"] as const)(
    "releases session handles before switching users drains an eject via %s",
    async (entry) => {
      caller.sessionId = eden.runtime.services.sessionContext.getSessionId();
      await eden.runtime.effects.run(
        eden.runtime.users.create({
          username: "other",
          name: "Other",
          password: "password",
        }),
      );
      await launchOwner(true);
      await execute("fs/open", { location });
      const eject = await eden.execute<OperationHandle>(
        "volume/eject",
        { volume: "usb" },
        caller,
      );
      if (entry === "operation")
        await eden.complete("session/login", {
          username: "other",
          password: "password",
        });
      else
        await eden.runtime.effects.run(
          eden.runtime.sessions.login("other", "password"),
        );
      await eden.runtime.effects.run(
        eden.runtime.services.operations.wait(eject, caller),
      );
      expect(ejected).toBe(true);
      expect(eden.runtime.sessions.current()?.username).toBe("other");
      expect(
        eden.runtime.services.processes.getAppInstance(appId),
      ).toBeUndefined();
    },
  );

  it.each(["poweroff", "reboot"] as const)(
    "releases retained handles before %s drains an eject",
    async (action) => {
      await launchOwner(true);
      await execute("fs/open", { location });
      const eject = await eden.execute<OperationHandle>(
        "volume/eject",
        { volume: "usb" },
        caller,
      );
      await eden.complete("system/power", { action });
      await eden.runtime.effects.run(
        eden.runtime.services.operations.wait(eject, caller),
      );
      expect(ejected).toBe(true);
      expect(powerHandoffs).toBe(1);
      expect(
        eden.runtime.services.processes.getAppInstance(appId),
      ).toBeUndefined();
    },
  );

  it("preserves runtime-owned handles across logout and accepts handles in the next session", async () => {
    caller.sessionId = eden.runtime.services.sessionContext.getSessionId();
    const runtimeOwner = {
      ...caller,
      sessionId: "daemon:file-reader",
      principal: { kind: "system" as const },
    };
    const sessionHandle = await execute<FilesystemHandle>("fs/open", {
      location,
    });
    const runtimeHandle = await execute<FilesystemHandle>(
      "fs/open",
      { location },
      runtimeOwner,
    );
    await eden.runtime.effects.run(eden.runtime.sessions.logout());
    await expect(
      execute("fs/read", { location: sessionHandle }),
    ).rejects.toThrow(/unavailable/);
    expect(
      await execute("fs/read", { location: runtimeHandle }, runtimeOwner),
    ).toBe("original");
    await eden.runtime.effects.run(
      eden.runtime.sessions.login("operator", "password"),
    );
    caller.sessionId = eden.runtime.services.sessionContext.getSessionId();
    const nextHandle = await execute<FilesystemHandle>("fs/open", { location });
    expect(await execute("fs/read", { location: nextHandle })).toBe("original");
  });

  it("allows new handles after a failed power handoff", async () => {
    const handle = await execute<FilesystemHandle>("fs/open", { location });
    powerFailure = new Error("Host refused poweroff");
    const transition = eden.complete("system/power", { action: "poweroff" });
    await expect(transition).rejects.toThrow("Host refused poweroff");
    await expect(execute("fs/read", { location: handle })).rejects.toThrow(
      /unavailable/,
    );
    const reopened = await execute<FilesystemHandle>("fs/open", { location });
    expect(await execute("fs/read", { location: reopened })).toBe("original");
  });
});
