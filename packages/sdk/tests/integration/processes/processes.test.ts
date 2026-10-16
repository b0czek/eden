import nativeFs from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { bundle } from "@edenapp/genesis";
import * as packageBundler from "@edenapp/genesis/dist/bundler";
import type { OperationHandle, UserProfile } from "@edenapp/types";
import type { Operations } from "../../../src/operations/service";
import type { PackageCatalog } from "../../../src/packages/catalog";
import type { InstalledPackages } from "../../../src/packages/installed";
import type { Packages } from "../../../src/packages/service";
import type { Processes } from "../../../src/processes/service";
import type { Views } from "../../../src/views/service";
import { testApp } from "../../support/apps";
import { gate } from "../../support/async";
import { createTestEden, type TestEden } from "../../support/createTestEden";

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
    const profile = await eden.runtime.users.create({
      username: "exiting",
      name: "Exiting",
      password: "password",
      grants: [`apps/launch/${appId}`],
    });
    await eden.runtime.sessions.login(profile.username, "password");
    await eden.complete("process/launch", { appId });
    const processes = eden.runtime.services.processes;
    const instance = processes.getAppInstance(appId)!;
    const view = eden.runtime.services.views.getViewInfo(instance.viewId)!.view;
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
    await eden.runtime.services.operations.wait(handle, caller(appId, profile));
    expect(processes.getAppInstance(appId)).toBeUndefined();
    expect(view.webContents.isDestroyed()).toBe(true);
    expect(eden.runtime.operations.get(handle)).toMatchObject({
      status: "succeeded",
      result: { success: true },
    });
  });

  it("enforces process ownership through the real command path", async () => {
    eden = await createTestEden();
    const target = testApp("com.example.target", { name: "Target App" });
    eden.runtime.services.installedPackages.register(target);
    eden.runtime.services.permissions.registerApp("com.example.controller", [
      "process/manage",
    ]);
    const alice = await eden.runtime.users.create({
      username: "alice",
      name: "Alice",
      password: "password",
      grants: [`apps/launch/${target.id}`],
    });
    const bob = await eden.runtime.users.create({
      username: "bob",
      name: "Bob",
      password: "password",
    });
    await eden.runtime.sessions.login(alice.username, "password");

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

  it("rejects launches while the package processes marks a host as changing", async () => {
    eden = await createTestEden();
    const target = testApp("com.example.guarded", { name: "Guarded App" });
    eden.runtime.services.permissions.registerApp("com.example.controller", [
      "process/manage",
    ]);
    const user = await eden.runtime.users.create({
      username: "operator",
      name: "Operator",
      password: "password",
      grants: [`apps/launch/${target.id}`],
    });
    await eden.runtime.sessions.login(user.username, "password");

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
    await eden.runtime.packages.install(archive);
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
    const replacement = eden.runtime.packages.install(archive, {
      replace: true,
    });
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
      await eden.runtime.dispose();
      await closed.promise;
      await expect(fs.access(stateDirectory)).resolves.toBeUndefined();
    } finally {
      observing.mockRestore();
      await fs.rm(stateRoot, { recursive: true, force: true });
    }
  });
});
