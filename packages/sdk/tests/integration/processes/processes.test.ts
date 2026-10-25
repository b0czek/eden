import nativeFs from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { bundle } from "@edenapp/genesis";
import * as packageBundler from "@edenapp/genesis/dist/bundler";
import type { OperationHandle, UserProfile } from "@edenapp/types";
import { testApp } from "../../support/apps";
import { gate, tick } from "../../support/async";
import { createTestEden, type TestEden } from "../../support/create-test-eden";

const caller = (appId: string, profile: UserProfile) => ({
  appId,
  principal: { kind: "user" as const, profile },
});

describe("Processes integration", () => {
  let eden: TestEden;

  afterEach(async () => {
    await eden?.dispose();
  });

  it("queues renderer self-exit acceptance before destroying the caller", async () => {
    eden = await createTestEden();
    const appId = "com.example.self-exit";
    eden.runtime.services.installedPackages.register(
      testApp(appId, { name: "Self exit" }),
    );
    const profile = await eden.runtime.effects.run(
      eden.runtime.users.create({
        username: "exiting",
        name: "Exiting",
        password: "password",
        grants: [`apps/launch/${appId}`],
      }),
    );
    await eden.runtime.effects.run(
      eden.runtime.sessions.login(profile.username, "password"),
    );
    await eden.complete("process/launch", { appId });
    const processes = eden.runtime.services.processes;
    const view = eden.getAppView(appId).view;
    const response = (await eden.platform.rendererIpc.invoke(
      "shell-command",
      view.webContents.id,
      "process/exit",
      {},
    )) as { mode: "operation"; handle: OperationHandle };
    const handle = response.handle;
    expect(handle).toMatchObject({
      command: "process/exit",
      id: expect.any(String),
    });
    expect(processes.getAppInstance(appId)).toBeDefined();
    await eden.runtime.effects.run(
      eden.runtime.services.operations.wait(handle, caller(appId, profile)),
    );
    expect(processes.getAppInstance(appId)).toBeUndefined();
    expect(view.webContents.isDestroyed()).toBe(true);
    expect(eden.runtime.operations.get(handle)).toMatchObject({
      status: "succeeded",
      result: { success: true },
    });
  });

  it("queues backend self-exit during startup without process management permission", async () => {
    eden = await createTestEden();
    const appId = "com.example.starting-self-exit";
    const { processes, operations } = eden.runtime.services;
    eden.runtime.services.installedPackages.register(
      testApp(appId, {
        frontend: undefined,
        backend: { entry: "backend.js" },
      }),
    );
    const starting = eden.runtime.effects.run(
      processes.launchDaemon(appId, { kind: "system" }),
    );
    await tick();
    const backend = eden.getBackendProcess(appId);
    const owner = {
      appId,
      sessionId: "runtime",
      principal: { kind: "system" as const },
    };
    let exiting: OperationHandle;
    try {
      backend.emit("message", {
        type: "shell-command",
        command: "process/exit",
        commandId: "startup-self-exit",
        args: {},
      });
      await tick();
      const response = backend.messages.find(
        (message) =>
          message !== null &&
          typeof message === "object" &&
          "commandId" in message &&
          message.commandId === "startup-self-exit",
      ) as { result: { handle: OperationHandle } };
      expect(response).toMatchObject({
        type: "shell-command-response",
        result: {
          mode: "operation",
          handle: { command: "process/exit", id: expect.any(String) },
        },
      });
      exiting = response.result.handle;
      expect(operations.inspect(exiting)?.status).toBe("running");
    } finally {
      backend.emit("message", { type: "backend-ready" });
      await starting;
    }
    await expect(
      eden.runtime.effects.run(operations.wait(exiting, owner)),
    ).resolves.toEqual({ success: true });
    expect(processes.getAppInstance(appId)).toBeUndefined();
    expect(eden.runtime.services.backends.getBackend(appId)).toBeUndefined();
  });

  it("enforces process ownership through the real command path", async () => {
    eden = await createTestEden();
    const target = testApp("com.example.target", { name: "Target App" });
    eden.runtime.services.installedPackages.register(target);
    eden.runtime.services.permissions.registerApp("com.example.controller", [
      "process/manage",
    ]);
    const alice = await eden.runtime.effects.run(
      eden.runtime.users.create({
        username: "alice",
        name: "Alice",
        password: "password",
        grants: [`apps/launch/${target.id}`],
      }),
    );
    const bob = await eden.runtime.effects.run(
      eden.runtime.users.create({
        username: "bob",
        name: "Bob",
        password: "password",
      }),
    );
    await eden.runtime.effects.run(
      eden.runtime.sessions.login(alice.username, "password"),
    );

    await eden.complete(
      "process/launch",
      { appId: target.id },
      caller("com.example.controller", alice),
    );
    await expect(
      eden.complete(
        "process/stop",
        { appId: target.id },
        caller("com.example.controller", bob),
      ),
    ).rejects.toThrow(`User cannot stop process ${target.id}`);
    expect(
      eden.runtime.services.processes.getAppInstance(target.id),
    ).toBeDefined();

    await expect(
      eden.complete(
        "process/stop",
        { appId: target.id },
        caller("com.example.controller", alice),
      ),
    ).resolves.toEqual({ success: true });
    expect(
      eden.runtime.services.processes.getAppInstance(target.id),
    ).toBeUndefined();
  });

  it.each(["alice", "bob"])(
    "keeps a queued self-exit from stopping %s's replacement instance",
    async (replacementOwner) => {
      eden = await createTestEden();
      const appId = "com.example.queued-self-exit";
      const { processes, operations } = eden.runtime.services;
      eden.runtime.services.installedPackages.register(
        testApp(appId, {
          frontend: undefined,
          backend: { entry: "backend.js" },
        }),
      );
      const alice = await eden.runtime.effects.run(
        eden.runtime.users.create({
          username: "alice",
          name: "Alice",
          password: "password",
          grants: ["*"],
        }),
      );
      if (replacementOwner !== "alice")
        await eden.runtime.effects.run(
          eden.runtime.users.create({
            username: replacementOwner,
            name: replacementOwner,
            password: "password",
            grants: ["*"],
          }),
        );
      await eden.runtime.effects.run(
        eden.runtime.sessions.login(replacementOwner, "password"),
      );
      const starting = eden.runtime.effects
        .run(
          processes.launchDaemon(
            appId,
            { kind: "user", username: "alice" },
            alice,
          ),
        )
        .catch((error: unknown) => error);
      await tick();
      const original = eden.getBackendProcess(appId);
      const owner = { ...caller(appId, alice), sessionId: "runtime" };
      let replacement: OperationHandle;
      let exiting: OperationHandle;
      try {
        replacement = await eden.execute<OperationHandle>("process/launch", {
          appId,
        });
        await tick();
        exiting = await eden.execute<OperationHandle>(
          "process/exit",
          {},
          owner,
        );
        await tick();
        expect(operations.inspect(exiting)?.status).toBe("running");
      } finally {
        original.emit("message", {
          type: "backend-error",
          error: "Original startup failed",
        });
        await starting;
      }
      expect(await starting).toMatchObject({ _tag: "BackendStartupFailed" });
      await tick();
      const next = eden.getBackendProcess(appId);
      expect(next).not.toBe(original);
      next.emit("message", { type: "backend-ready" });
      await expect(
        eden.runtime.effects.run(operations.wait(replacement, {})),
      ).resolves.toMatchObject({ success: true, appId });
      await expect(
        eden.runtime.effects.run(operations.wait(exiting, owner)),
      ).rejects.toThrow(`Originating process ${appId} is no longer running`);
      expect(processes.getAppInstance(appId)).toMatchObject({
        instanceId: expect.any(String),
        principal: { kind: "user", username: replacementOwner },
      });
      expect(eden.getBackendProcess(appId)).toBe(next);
    },
  );

  it.each(["alice", "bob"])(
    "checks %s's queued renderer stop against the owner after daemon startup",
    async (username) => {
      eden = await createTestEden();
      const appId = "com.example.starting-daemon";
      const controllerId = "com.example.controller";
      const { processes, operations, sessionContext } = eden.runtime.services;
      eden.runtime.services.installedPackages.register(
        testApp(appId, {
          frontend: undefined,
          backend: { entry: "backend.js" },
        }),
      );
      eden.runtime.services.installedPackages.register(
        testApp(controllerId, {
          permissions: ["process/manage"],
          window: {
            mode: "floating",
            injections: { css: "none", appFrame: "none" },
          },
        }),
      );
      eden.runtime.services.permissions.registerApp(controllerId, [
        "process/manage",
      ]);
      const profiles = await Promise.all(
        ["alice", "bob"].map((name) =>
          eden.runtime.effects.run(
            eden.runtime.users.create({
              username: name,
              name,
              password: "password",
              grants: [`apps/launch/${controllerId}`],
            }),
          ),
        ),
      );
      const alice = profiles[0];
      if (!alice) throw new Error("Missing daemon owner");
      await eden.runtime.effects.run(
        eden.runtime.sessions.login(username, "password"),
      );
      await eden.complete("process/launch", { appId: controllerId });
      const launching = eden.runtime.effects.run(
        processes.launchDaemon(
          appId,
          { kind: "user", username: "alice" },
          alice,
        ),
      );
      await tick();
      const backend = eden.getBackendProcess(appId);
      let handle: OperationHandle;
      try {
        expect(processes.getAppInstance(appId)).toBeUndefined();
        handle = await eden.executeFromView<OperationHandle>(
          eden.getAppView(controllerId).view.webContents.id,
          "process/stop",
          { appId },
        );
        await tick();
        expect(operations.inspect(handle)?.status).toBe("running");
      } finally {
        backend.emit("message", { type: "backend-ready" });
        await launching;
      }
      const stopping = eden.runtime.effects.run(
        operations.wait(handle, {
          appId: controllerId,
          sessionId: sessionContext.getSessionId(),
        }),
      );
      if (username === "alice") {
        await expect(stopping).resolves.toEqual({ success: true });
        expect(processes.getAppInstance(appId)).toBeUndefined();
      } else {
        await expect(stopping).rejects.toThrow(
          `User cannot stop process ${appId}`,
        );
        expect(processes.getAppInstance(appId)?.principal).toEqual({
          kind: "user",
          username: "alice",
        });
      }
    },
  );

  it("rejects launches while the package processes marks a host as changing", async () => {
    eden = await createTestEden();
    const target = testApp("com.example.guarded", { name: "Guarded App" });
    eden.runtime.services.permissions.registerApp("com.example.controller", [
      "process/manage",
    ]);
    const user = await eden.runtime.effects.run(
      eden.runtime.users.create({
        username: "operator",
        name: "Operator",
        password: "password",
        grants: [`apps/launch/${target.id}`],
      }),
    );
    await eden.runtime.effects.run(
      eden.runtime.sessions.login(user.username, "password"),
    );

    const processes = eden.runtime.services.processes;
    const source = path.join(eden.paths.root, "replacement-source");
    const archive = path.join(eden.paths.root, "replacement.edenite");
    await fs.mkdir(source);
    const manifest = {
      id: target.id,
      name: target.name,
      version: target.version,
      frontend: { entry: "index.html" },
    };
    await fs.writeFile(
      path.join(source, "manifest.json"),
      JSON.stringify(manifest),
    );
    await fs.writeFile(
      path.join(source, "index.html"),
      "<html>Replacement</html>",
    );
    const initial = await bundle({ appDirectory: source, outputPath: archive });
    if (!initial.success) throw new Error(initial.error);
    await eden.runtime.effects.run(eden.runtime.packages.install(archive));
    await fs.writeFile(
      path.join(source, "manifest.json"),
      JSON.stringify({ ...manifest, version: "2.0.0" }),
    );
    const bundled = await bundle({ appDirectory: source, outputPath: archive });
    if (!bundled.success) throw new Error(bundled.error);

    let releaseExtraction!: () => void;
    const extractionGate = new Promise<void>((resolve) => {
      releaseExtraction = resolve;
    });
    let extractionStarted!: () => void;
    const extracting = new Promise<void>((resolve) => {
      extractionStarted = resolve;
    });
    const extract = packageBundler.extract;
    const gatedExtraction = jest
      .spyOn(packageBundler, "extract")
      .mockImplementation(async (options) => {
        extractionStarted();
        await extractionGate;
        return extract(options);
      });
    const replacement = eden.runtime.effects.run(
      eden.runtime.packages.install(archive, {
        replace: true,
      }),
    );
    try {
      await extracting;
      expect(eden.runtime.services.catalog.getApp(target.id)?.version).toBe(
        target.version,
      );
      await expect(
        eden.complete(
          "process/launch",
          { appId: target.id },
          caller("com.example.controller", user),
        ),
      ).rejects.toThrow(`App ${target.id} is not installed`);
      expect(processes.getAppInstance(target.id)).toBeUndefined();
    } finally {
      releaseExtraction();
      await replacement.finally(() => gatedExtraction.mockRestore());
    }
    expect(eden.runtime.packages.get(target.id)?.manifest.version).toBe(
      "2.0.0",
    );

    await eden.complete(
      "process/launch",
      { appId: target.id },
      caller("com.example.controller", user),
    );
    expect(processes.getAppInstance(target.id)).toBeDefined();
  });

  it("closes the acquired hot-reload watcher during shutdown", async () => {
    const stateRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "eden-hot-reload-test-"),
    );
    const stateDirectory = path.join(stateRoot, "state");
    const closed = gate();
    const watch = nativeFs.watch;
    const observing = jest.spyOn(nativeFs, "watch").mockImplementation(((
      ...args: Parameters<typeof nativeFs.watch>
    ) => {
      const watcher = watch(...args);
      if (String(args[0]) === stateDirectory)
        watcher.once("close", closed.release);
      return watcher;
    }) as typeof nativeFs.watch);
    try {
      eden = await createTestEden({
        config: { hotReload: { enabled: true, stateDirectory } },
      });
      await eden.runtime.effects.run(
        eden.runtime.services.processes.shutdown(),
      );
      await closed.promise;
      await expect(fs.access(stateDirectory)).resolves.toBeUndefined();
    } finally {
      observing.mockRestore();
      await fs.rm(stateRoot, { recursive: true, force: true });
    }
  });
});
