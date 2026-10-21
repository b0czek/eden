import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type {
  FilePickerOpenArgs,
  FilePickerOpenEvent,
  FilePickerResult,
  UserProfile,
  ViewBounds,
} from "@edenapp/types";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { AppAssociationStorage } from "../../../src/app-associations/ports";
import {
  AppAssociations,
  AppAssociationsLive,
} from "../../../src/app-associations/service";
import type { TargetedNotification } from "../../../src/controllers/events";
import { createEvent } from "../../../src/events/event";
import {
  ExecutionContext,
  ExecutionContextLive,
} from "../../../src/execution/context";
import {
  createFilePickerFiles,
  createFilePickerProcesses,
} from "../../../src/file-picker/adapters";
import { createFilePickerController } from "../../../src/file-picker/controller-edenapi";
import {
  FilePickerFiles,
  FilePickerNotifications,
  FilePickerProcesses,
  FilePickerViews,
} from "../../../src/file-picker/ports";
import { FilePicker, FilePickerLive } from "../../../src/file-picker/service";
import { FilesystemIoFailed } from "../../../src/filesystem/native-errors";

import { Volumes, VolumesLive } from "../../../src/filesystem/volumes/service";
import { Permissions, PermissionsLive } from "../../../src/ipc/permissions";
import {
  PackageCatalog,
  PackageCatalogLive,
} from "../../../src/packages/catalog";
import {
  InstalledPackages,
  InstalledPackagesLive,
} from "../../../src/packages/installed";
import {
  AppsDirectory,
  DistPath,
  RuntimeConfig,
} from "../../../src/runtime/inputs";
import { testApp } from "../../support/apps";
import {
  buildService,
  createEffectRuntime,
} from "../../support/effect-runtime";

const serviceEffects = createEffectRuntime();
afterAll(() => serviceEffects.dispose());

interface FilePickerTestPorts {
  associations: AppAssociations;
  views: FilePickerViews;
  processes: FilePickerProcesses;
  files: FilePickerFiles;
  volumes: Volumes;
  permissions: Permissions;
  notifications: FilePickerNotifications;
}

const provider = { appId: "com.example.picker", webContentsId: 100 };
const opener = { appId: "com.example.editor", webContentsId: 200 };
const other = { appId: "com.example.notes", webContentsId: 201 };
const bounds: ViewBounds = { x: 120, y: 80, width: 640, height: 420 };
const vendor: UserProfile = {
  username: "vendor",
  name: "Vendor",
  role: "vendor",
  grants: [],
  createdAt: 0,
  updatedAt: 0,
};

async function createScenario() {
  const runtime = createEffectRuntime();
  const execution = serviceEffects.acquireSync(
    buildService(ExecutionContext, ExecutionContextLive).pipe(
      Effect.provideService(RuntimeConfig, {}),
    ),
  );
  const run = <A, E>(work: Effect.Effect<A, E>) =>
    runtime.run(
      execution.provide(work, { principal: { kind: "user", profile: vendor } }),
    );
  const registry = serviceEffects.acquireSync(
    buildService(InstalledPackages, InstalledPackagesLive),
  );
  const permissions = serviceEffects.acquireSync(
    buildService(Permissions, PermissionsLive),
  );
  const installProvider = (id: string, permitted = true) => {
    registry.register(
      testApp(id, {
        frontend: { entry: "index.html" },
        permissions: permitted ? ["file-picker/display"] : [],
      }),
    );
    permissions.registerApp(id, permitted ? ["file-picker/display"] : []);
  };
  installProvider(provider.appId);
  const catalog = serviceEffects.acquireSync(
    buildService(PackageCatalog, PackageCatalogLive).pipe(
      Effect.provideService(InstalledPackages, registry),
      Effect.provideService(ExecutionContext, execution),
      Effect.provideService(AppsDirectory, "/tmp"),
      Effect.provideService(DistPath, "/tmp"),
    ),
  );
  const associations = await runtime.acquire(
    buildService(AppAssociations, AppAssociationsLive).pipe(
      Effect.provideService(PackageCatalog, catalog),
      Effect.provideService(AppAssociationStorage, {
        read: () => Effect.succeed('{"version":1,"associations":{}}'),
        write: () => Effect.void,
      }),
    ),
  );
  await run(associations.initialize());
  const stopped = createEvent<{ appId: string }>();
  const running = new Set<string>([provider.appId]);
  const launches: string[] = [];
  let launched!: () => void;
  const launchRequested = new Promise<void>((resolve) => {
    launched = resolve;
  });
  const views = new Map<number, { alive: boolean; bounds: ViewBounds }>([
    [10, { alive: true, bounds }],
    [20, { alive: true, bounds }],
    [21, { alive: true, bounds }],
  ]);
  const revealed: number[] = [];
  const closed: TargetedNotification<FilePickerResult>[] = [];
  const opened: TargetedNotification<{ picker: FilePickerOpenEvent }>[] = [];
  const replacements: Effect.Effect<{ requestId: string }, Error>[] = [];
  const volumes = await runtime.acquire(buildService(Volumes, VolumesLive));
  const dependencies: FilePickerTestPorts = {
    associations,
    views: {
      resolve: (id) =>
        id === 100 ? 10 : id === 200 ? 20 : id === 201 ? 21 : undefined,
      get: (id) => views.get(id),
      reveal: (id) =>
        Effect.sync(() => {
          revealed.push(id);
        }),
    },
    processes: {
      ensureRunning: (id) =>
        Effect.sync(() => {
          launches.push(id);
          running.add(id);
          launched();
        }),
      isRunning: (id) => running.has(id),
      stop: (id) =>
        Effect.sync(() => {
          running.delete(id);
          stopped.emit({ appId: id });
        }),
      stopped,
    },
    notifications: {
      busy: (replace) =>
        Effect.sync(() => {
          replacements.push(replace);
        }),
    },
    permissions,
    volumes,
    files: {
      accessScope: (volume) => ({ volume, path: "/" }),
      resolvePath: () => Effect.void,
    },
  };
  const picker = await runtime.acquire(
    buildService(FilePicker, FilePickerLive).pipe(
      Effect.provideService(AppAssociations, dependencies.associations),
      Effect.provideService(FilePickerViews, dependencies.views),
      Effect.provideService(FilePickerProcesses, dependencies.processes),
      Effect.provideService(FilePickerFiles, dependencies.files),
      Effect.provideService(Volumes, dependencies.volumes),
      Effect.provideService(Permissions, dependencies.permissions),
      Effect.provideService(
        FilePickerNotifications,
        dependencies.notifications,
      ),
    ),
  );
  picker.closed.on((event) => {
    closed.push(event);
  });
  picker.opened.on((event) => {
    opened.push(event);
  });
  const open = (args: FilePickerOpenArgs = { mode: "open" }, caller = opener) =>
    run(picker.openPicker(args, caller));
  const register = (caller = provider) =>
    run(picker.registerDisplayProvider(caller));
  return {
    runtime,
    run,
    picker,
    associations,
    stopped,
    running,
    launches,
    launchRequested,
    views,
    revealed,
    closed,
    opened,
    replacements,
    dependencies,
    registry,
    installProvider,
    volumes,
    open,
    register,
  };
}

type Scenario = Awaited<ReturnType<typeof createScenario>>;
const resources: Scenario[] = [];
async function scenario() {
  const result = await createScenario();
  resources.push(result);
  return result;
}

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    await resource.runtime.dispose();
    resource.stopped.dispose();
  }
  jest.useRealTimers();
});

describe("file picker composition and request lifecycle", () => {
  it("delivers request and selection only to the provider and opener", async () => {
    const s = await scenario();
    await s.register();
    const { requestId } = await s.open({
      mode: "open",
      filters: [{ name: "Text", extensions: ["txt"] }],
    });
    expect(s.opened).toEqual([
      {
        viewIds: [10, 20],
        payload: {
          picker: {
            mode: "open",
            filters: [{ name: "Text", extensions: ["txt"] }],
            initialLocation: { volume: "home", path: "/" },
            requestId,
            opener: { appId: opener.appId, viewId: 20, bounds },
          },
        },
      },
    ]);
    expect(s.revealed).toEqual([10]);
    const result: FilePickerResult = {
      requestId,
      reason: "select",
      locations: [{ volume: "home", path: "/Documents/readme.txt" }],
    };
    const controller = createFilePickerController(s.picker);
    expect(
      await s.run(
        controller.commands.resolve.execute(
          {
            ...result,
            _callerAppId: "com.example.spoofed",
            _callerWebContentsId: 201,
          },
          provider,
        ) as Effect.Effect<{ success: boolean }, Error>,
      ),
    ).toEqual({ success: true });
    expect(s.closed).toEqual([{ viewIds: [10, 20], payload: result }]);
  });

  it("launches the configured provider and waits for its view registration", async () => {
    const s = await scenario();
    s.installProvider("com.example.selected");
    await s.run(
      s.associations.set("provider:file-picker", {
        appId: "com.example.selected",
        kind: "provider",
      }),
    );
    const opening = s.open();
    await s.launchRequested;
    expect(s.opened).toEqual([]);
    await expect(
      s.register({ ...provider, appId: "com.example.unexpected" }),
    ).rejects.toThrow("does not match expected app com.example.selected");
    await s.register({ ...provider, appId: "com.example.selected" });
    await expect(opening).resolves.toEqual({ requestId: expect.any(String) });
    expect(s.launches).toEqual(["com.example.selected"]);
  });

  it("uses permitted catalog providers and rejects missing or ambiguous choices", async () => {
    const s = await scenario();
    s.registry.unregister(provider.appId);
    s.installProvider("com.example.unpermitted", false);
    await expect(s.open()).rejects.toThrow(
      "No file picker display provider is installed or permitted",
    );
    s.installProvider("com.example.first");
    s.installProvider("com.example.second");
    await expect(s.open()).rejects.toThrow(
      "Multiple file picker display providers are available: com.example.first, com.example.second",
    );
    expect(s.launches).toEqual([]);
  });

  it("rejects timed-out provider startup and allows a later registered provider", async () => {
    const s = await scenario();
    jest.useFakeTimers({ doNotFake: ["queueMicrotask", "setImmediate"] });
    const opening = s.open();
    const rejected = expect(opening).rejects.toThrow(
      "Timed out waiting for File picker display provider",
    );
    await s.launchRequested;
    await jest.advanceTimersByTimeAsync(5_000);
    await rejected;
    await s.register();
    await expect(s.open()).resolves.toEqual({ requestId: expect.any(String) });
  });

  it("requires a renderer provider and trusted view identity for opening and resolution", async () => {
    const s = await scenario();
    await expect(
      s.register({ appId: provider.appId } as typeof provider),
    ).rejects.toThrow("display provider must be a valid view");
    await s.register();
    await expect(
      s.run(s.picker.openPicker({ mode: "open" }, { appId: opener.appId })),
    ).rejects.toThrow("only be opened from a renderer view");
    await expect(s.open({ mode: "open" }, provider)).rejects.toThrow(
      "Display provider cannot open file pickers",
    );
    const { requestId } = await s.open();
    await expect(
      s.run(s.picker.resolvePicker({ requestId, reason: "cancel" }, opener)),
    ).rejects.toThrow("Only the display provider can resolve file pickers");
    expect(s.closed).toEqual([]);
    expect(await s.run(s.picker.closePicker(requestId, opener))).toEqual({
      success: true,
    });
  });

  it("keeps a request active after invalid selection, and rejects another view closing it", async () => {
    const s = await scenario();
    await s.register();
    const { requestId } = await s.open();
    for (const locations of [
      undefined,
      null,
      {},
      [],
      [null],
      [{ volume: "home" }],
    ]) {
      await expect(
        s.run(
          s.picker.resolvePicker(
            { requestId, reason: "select", locations } as never,
            provider,
          ),
        ),
      ).rejects.toThrow();
    }
    await expect(s.run(s.picker.closePicker(requestId, other))).rejects.toThrow(
      "Only the original opener can close this file picker",
    );
    expect(s.closed).toEqual([]);
    expect(await s.run(s.picker.closePicker(requestId, opener))).toEqual({
      success: true,
    });
  });

  it("preserves volume restrictions and ready/read-only checks before accepting selection", async () => {
    const s = await scenario();
    const rootPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "eden-picker-volume-"),
    );
    const registration = {
      id: "archive",
      label: "Archive",
      kind: "removable" as const,
      rootPath,
    };
    try {
      await s.run(s.volumes.register({ ...registration, readOnly: true }));
      await s.register();
      const { requestId } = await s.open({
        mode: "save",
        allowedVolumes: ["archive"],
      });
      expect(s.opened[0]).toMatchObject({
        payload: {
          picker: { initialLocation: { volume: "archive", path: "/" } },
        },
      });
      await expect(
        s.run(
          s.picker.resolvePicker(
            {
              requestId,
              reason: "select",
              locations: [{ volume: "home", path: "/x" }],
            },
            provider,
          ),
        ),
      ).rejects.toThrow("Selected volume is not allowed");
      await expect(
        s.run(
          s.picker.resolvePicker(
            {
              requestId,
              reason: "select",
              locations: [{ volume: "archive", path: "/x" }],
            },
            provider,
          ),
        ),
      ).rejects.toThrow("Selected volume is read-only");
      s.volumes.unregister("archive");
      await s.run(
        s.volumes.register(registration, {
          eject: () => Effect.promise(async () => undefined),
        }),
      );
      const eject = s.volumes.prepareEject("archive");
      await expect(
        s.run(
          s.picker.resolvePicker(
            {
              requestId,
              reason: "select",
              locations: [{ volume: "archive", path: "/x" }],
            },
            provider,
          ),
        ),
      ).rejects.toThrow("Selected volume is being removed");
      const ejectWork = eject.run({ update() {} });
      await (Effect.isEffect(ejectWork) ? s.run(ejectWork) : ejectWork);
      await s.run(s.volumes.register(registration));
      expect(
        await s.run(
          s.picker.resolvePicker(
            {
              requestId,
              reason: "select",
              locations: [{ volume: "archive", path: "/x" }],
            },
            provider,
          ),
        ),
      ).toEqual({ success: true });
    } finally {
      s.volumes.unregister("archive");
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("propagates initial-location failures before opening a provider or creating a request", async () => {
    const s = await scenario();
    const failure = new FilesystemIoFailed({
      operation: "resolve-path",
      message: "Location is unavailable",
      cause: new Error("Location is unavailable"),
    });
    s.dependencies.files.resolvePath = createFilePickerFiles({
      accessScope: (volume) => ({ volume, path: "/" }),
      resolvePath: () => Effect.fail(failure),
    }).resolvePath;
    await expect(
      s.open({
        mode: "open",
        initialLocation: { volume: "home", path: "/missing" },
      }),
    ).rejects.toBe(failure);
    expect(s.opened).toEqual([]);
    expect(s.launches).toEqual([]);
    await s.register();
    await expect(s.open()).resolves.toEqual({ requestId: expect.any(String) });
  });

  it("keeps unexpected collaborator exceptions outside the recoverable failure channel", async () => {
    const s = await scenario();
    await s.register();
    const defect = new Error("Broken view registry");
    s.dependencies.views.resolve = () => {
      throw defect;
    };
    const exit = await s.run(
      Effect.exit(s.picker.openPicker({ mode: "open" }, opener)),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.hasFails(exit.cause)).toBe(false);
    }
    expect(s.opened).toEqual([]);
  });

  it("lets a busy notification replace the active request and route both outcomes", async () => {
    const s = await scenario();
    await s.register();
    const first = await s.open();
    await expect(
      s.open({ mode: "save", suggestedName: "report.md" }, other),
    ).rejects.toThrow("File picker is busy");
    expect(s.opened).toHaveLength(1);
    const second = await s.run(s.replacements[0]);
    expect(s.closed).toEqual([
      {
        viewIds: [10, 20],
        payload: { requestId: first.requestId, reason: "close" },
      },
    ]);
    expect(s.opened[1]).toMatchObject({
      viewIds: [10, 21],
      payload: {
        picker: {
          requestId: second.requestId,
          mode: "save",
          suggestedName: "report.md",
        },
      },
    });
  });

  it("permits provider close, re-registration and cancellation to release the active request", async () => {
    const s = await scenario();
    await s.register();
    const first = await s.open();
    expect(
      await s.run(s.picker.closePicker(first.requestId, provider)),
    ).toEqual({ success: true });
    const second = await s.open();
    await s.register();
    const third = await s.open();
    expect(
      await s.run(
        s.picker.resolvePicker(
          { requestId: third.requestId, reason: "cancel" },
          provider,
        ),
      ),
    ).toEqual({ success: true });
    expect(s.closed.map((entry) => entry.payload)).toEqual([
      { requestId: first.requestId, reason: "close" },
      { requestId: second.requestId, reason: "close" },
      { requestId: third.requestId, reason: "cancel" },
    ]);
    await expect(s.open()).resolves.toEqual({ requestId: expect.any(String) });
  });

  it("closes orphaned requests when the provider or opener stops", async () => {
    const s = await scenario();
    await s.register();
    const first = await s.open();
    s.stopped.emit({ appId: opener.appId });
    const second = await s.open({ mode: "open" }, other);
    s.stopped.emit({ appId: provider.appId });
    expect(s.closed).toEqual([
      {
        viewIds: [10, 20],
        payload: { requestId: first.requestId, reason: "close" },
      },
      {
        viewIds: [21],
        payload: { requestId: second.requestId, reason: "close" },
      },
    ]);
    const opening = s.open();
    await s.launchRequested;
    await s.register();
    await expect(opening).resolves.toEqual({ requestId: expect.any(String) });
  });

  it("prunes vanished opener and provider views before a new request", async () => {
    const s = await scenario();
    await s.register();
    const first = await s.open();
    s.views.delete(20);
    await s.open({ mode: "open" }, other);
    expect(s.closed[0]).toMatchObject({
      payload: { requestId: first.requestId, reason: "close" },
    });
    s.views.delete(10);
    const opening = s.open({ mode: "open" }, other);
    await s.launchRequested;
    s.views.set(10, { alive: true, bounds });
    await s.register();
    await expect(opening).resolves.toEqual({ requestId: expect.any(String) });
    expect(s.replacements).toEqual([]);
  });

  it("stops an idle provider after ten seconds and cancels shutdown on a new request", async () => {
    const s = await scenario();
    jest.useFakeTimers({ doNotFake: ["queueMicrotask", "setImmediate"] });
    await s.register();
    const first = await s.open();
    await s.run(
      s.picker.resolvePicker(
        { requestId: first.requestId, reason: "cancel" },
        provider,
      ),
    );
    await jest.advanceTimersByTimeAsync(9_999);
    expect(s.running.has(provider.appId)).toBe(true);
    await s.open();
    await jest.advanceTimersByTimeAsync(1);
    expect(s.running.has(provider.appId)).toBe(true);
    await s.run(s.picker.closePicker(undefined, opener));
    await jest.advanceTimersByTimeAsync(10_000);
    expect(s.running.has(provider.appId)).toBe(false);
  });

  it("does not stop a replacement provider on the previous provider's idle deadline", async () => {
    const s = await scenario();
    jest.useFakeTimers({ doNotFake: ["queueMicrotask", "setImmediate"] });
    await s.register();
    const first = await s.open();
    await s.run(
      s.picker.resolvePicker(
        { requestId: first.requestId, reason: "cancel" },
        provider,
      ),
    );
    s.running.add("com.example.replacement");
    await s.register({ ...provider, appId: "com.example.replacement" });
    await jest.advanceTimersByTimeAsync(10_000);
    expect([...s.running]).toEqual([provider.appId, "com.example.replacement"]);
  });

  it("closes active requests and releases the stopped subscription during scope disposal", async () => {
    const s = await scenario();
    await s.register();
    const { requestId } = await s.open();
    expect(s.stopped.hasListeners()).toBe(true);
    await s.runtime.dispose();
    expect(s.closed).toEqual([
      { viewIds: [10, 20], payload: { requestId, reason: "close" } },
    ]);
    expect(s.stopped.hasListeners()).toBe(false);
    expect(s.picker.opened.hasListeners()).toBe(false);
    expect(s.picker.closed.hasListeners()).toBe(false);
  });

  it("cancels a pending idle shutdown when the service scope closes", async () => {
    const s = await scenario();
    jest.useFakeTimers({ doNotFake: ["queueMicrotask", "setImmediate"] });
    await s.register();
    const { requestId } = await s.open();
    await s.run(s.picker.closePicker(requestId, opener));
    await s.runtime.dispose();
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(s.running.has(provider.appId)).toBe(true);
  });

  it.each([false, true])(
    "finishes an idle provider stop before releasing its scope (activity resumes: %s)",
    async (resumeActivity) => {
      const s = await scenario();
      jest.useFakeTimers({ doNotFake: ["queueMicrotask", "setImmediate"] });
      let started!: () => void;
      let finish!: () => void;
      const stopping = new Promise<void>((resolve) => {
        started = resolve;
      });
      const finishStop = new Promise<void>((resolve) => {
        finish = resolve;
      });
      s.dependencies.processes.stop = createFilePickerProcesses({
        ensureAppRunning: () => Effect.succeed(undefined as never),
        getAppInstance: () => undefined,
        stopped: s.stopped,
        stopApp: () =>
          Effect.promise(async () => {
            started();
            await finishStop;
            s.running.delete(provider.appId);
            s.stopped.emit({ appId: provider.appId });
          }),
      }).stop;
      await s.register();
      const { requestId } = await s.open();
      await s.run(s.picker.closePicker(requestId, opener));
      await jest.advanceTimersByTimeAsync(10_000);
      await stopping;
      if (resumeActivity) await s.open();
      let disposed = false;
      const disposing = s.runtime.dispose().then(() => {
        disposed = true;
      });
      await jest.advanceTimersByTimeAsync(1);
      expect(disposed).toBe(false);
      expect(s.running.has(provider.appId)).toBe(true);
      finish();
      await disposing;
      expect(s.running.has(provider.appId)).toBe(false);
      expect(s.stopped.hasListeners()).toBe(false);
    },
  );

  it("interrupts provider registration waits on shutdown and releases their timers", async () => {
    const s = await scenario();
    jest.useFakeTimers({ doNotFake: ["queueMicrotask", "setImmediate"] });
    const opening = s.open();
    const rejected = expect(opening).rejects.toThrow();
    await s.launchRequested;
    await s.runtime.dispose();
    await rejected;
    await jest.advanceTimersByTimeAsync(15_000);
    expect(s.opened).toEqual([]);
    expect(s.running.has(provider.appId)).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });
});
