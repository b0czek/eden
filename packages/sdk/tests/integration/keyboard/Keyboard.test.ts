import { EventEmitter } from "node:events";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type {
  AppInstance,
  EdenKeyboardState,
  ViewBounds,
} from "@edenapp/types";
import * as Effect from "effect/Effect";
import { createEvent } from "../../../src/events/event";
import { ExecutionContext } from "../../../src/execution/context";
import { createKeyboardAssets } from "../../../src/keyboard/assets";
import { KeyboardAssets, KeyboardViews } from "../../../src/keyboard/ports";
import { Keyboard, KeyboardLive } from "../../../src/keyboard/service";
import { createKeyboardViews } from "../../../src/keyboard/views";
import {
  DisplayPort,
  RendererIpcPort,
  WindowingPort,
} from "../../../src/platform/ports/types";
import { Processes } from "../../../src/processes/service";
import { AppsDirectory } from "../../../src/runtime/inputs";
import { EDEN_SETTINGS_APP_ID } from "../../../src/settings/constants";
import { SettingsCatalog, SettingsStorage } from "../../../src/settings/ports";
import { Settings, SettingsLive } from "../../../src/settings/service";
import { SqliteSettingsStorageLive } from "../../../src/settings/sqlite-storage";
import type { ViewInfo } from "../../../src/views/types";
import { testApp } from "../../support/apps";
import { createTestExecutionContext } from "../../support/callers";
import {
  buildService,
  createEffectRuntime,
} from "../../support/effect-runtime";
import { InMemoryPlatform } from "../../support/InMemoryPlatform";

function unusedProcessMethod(): never {
  throw new Error("Keyboard must only observe process stop notifications");
}

const resources: Array<() => Promise<void>> = [];

async function createScenario(
  initial: Record<string, string> = {},
  beforeWindow?: (platform: InMemoryPlatform) => void,
  views?: KeyboardViews,
) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "eden-keyboard-"));
  const runtime = createEffectRuntime();
  const platform = new InMemoryPlatform(directory);
  const boundsChanged = createEvent<{ workspaceBounds: ViewBounds }>();
  const stopped = createEvent<{ appId: string }>();
  let lift = 0;
  resources.push(async () => {
    await runtime.dispose();
    for (const window of platform.windows.windows) window.close();
    boundsChanged.dispose();
    stopped.dispose();
    await fs.rm(directory, { recursive: true, force: true });
  });
  for (const folder of ["keyboard-ui", "foundation"])
    await fs.mkdir(path.join(directory, folder));
  await fs.writeFile(
    path.join(directory, "keyboard-ui/index.html"),
    "<!doctype html><title>Keyboard</title>",
  );
  await fs.writeFile(
    path.join(directory, "foundation/keyboard-preload.js"),
    "",
  );
  const settings = await runtime.acquire(
    buildService(Settings, SettingsLive).pipe(
      Effect.provideServiceEffect(
        SettingsStorage,
        buildService(SettingsStorage, SqliteSettingsStorageLive).pipe(
          Effect.provideService(AppsDirectory, directory),
        ),
      ),
      Effect.provideService(SettingsCatalog, {
        getAppSettings: () => undefined,
      }),
      Effect.provideServiceEffect(
        ExecutionContext,
        createTestExecutionContext(() => true),
      ),
    ),
  );
  for (const [key, value] of Object.entries(initial))
    await runtime.run(settings.set(EDEN_SETTINGS_APP_ID, key, value));
  beforeWindow?.(platform);
  const keyboard = await runtime.acquire(
    buildService(Keyboard, KeyboardLive).pipe(
      Effect.provideService(KeyboardAssets, createKeyboardAssets(directory)),
      Effect.provideService(Settings, settings),
      Effect.provideService(
        KeyboardViews,
        views ?? {
          resolve: () => undefined,
          get: () => undefined,
          list: () => [],
          send: () => true,
          setPresentationLift: (value) => {
            lift = value;
          },
          boundsChanged,
        },
      ),
      Effect.provideService(Processes, {
        stopped,
        launched: createEvent<{ instance: AppInstance }>(),
        reloading: createEvent<{ appId: string }>(),
        error: createEvent<{ appId: string; error: unknown }>(),
        exited: createEvent<{ appId: string; code: number }>(),
        assertCanLaunch: unusedProcessMethod,
        launchApp: unusedProcessMethod,
        launchDaemon: unusedProcessMethod,
        ensureAppRunning: unusedProcessMethod,
        stopApp: unusedProcessMethod,
        getRunningApps: unusedProcessMethod,
        getAppInstance: unusedProcessMethod,
        getInstalledManifest: unusedProcessMethod,
        getMetrics: unusedProcessMethod,
        shutdown: unusedProcessMethod,
        reloadApp: unusedProcessMethod,
        stopSessionApps: unusedProcessMethod,
      }),
      Effect.provideService(WindowingPort, platform.windows),
      Effect.provideService(RendererIpcPort, platform.rendererIpc),
      Effect.provideService(DisplayPort, platform.display),
    ),
  );
  await runtime.run(keyboard.initialize());
  const mainWindow = platform.windows.createWindow({
    width: 1280,
    height: 800,
  });
  await runtime.run(keyboard.setMainWindow(mainWindow));
  const state = () =>
    platform.rendererIpc.invoke(
      "eden-keyboard:get-state",
      0,
    ) as Promise<EdenKeyboardState>;
  const show = () => platform.rendererIpc.invoke("eden-keyboard:show", 0);
  const set = (key: string, value: string) =>
    runtime.run(settings.set(EDEN_SETTINGS_APP_ID, key, value));
  return {
    runtime,
    platform,
    settings,
    keyboard,
    mainWindow,
    state,
    show,
    set,
    boundsChanged,
    stopped,
    lift: () => lift,
  };
}

async function waitForState(
  scenario: Awaited<ReturnType<typeof createScenario>>,
  matches: (state: EdenKeyboardState) => boolean,
) {
  let latest = await scenario.state();
  for (let attempt = 0; !matches(latest) && attempt < 100; attempt++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
    latest = await scenario.state();
  }
  expect(matches(latest)).toBe(true);
  return latest;
}

afterEach(async () => {
  for (const cleanup of resources.splice(0)) await cleanup();
  jest.useRealTimers();
});

describe("keyboard settings and native lifetime", () => {
  it("loads stored preferences and reacts to native Settings writes without a Promise bridge", async () => {
    const s = await createScenario({
      "keyboard.enabled": "false",
      "general.interfaceScale": "1.5",
    });
    expect(await s.state()).toMatchObject({ enabled: false, visible: false });
    expect(await s.show()).toEqual({ success: false });
    const overlay = s.platform.windows.windows[1];
    expect(overlay.webContents.getZoomFactor()).toBe(1.5);
    await s.set("keyboard.enabled", "true");
    expect(await s.show()).toEqual({ success: true });
    expect(await s.state()).toMatchObject({
      visible: true,
      placementMode: "floating",
    });
    await s.set("keyboard.showNumberRow", "false");
    await waitForState(s, (state) => !state.showNumberRow);
    await s.set("general.interfaceScale", "9");
    await waitForState(s, () => overlay.webContents.getZoomFactor() === 2);
    await s.set("keyboard.enabled", "false");
    await waitForState(s, (state) => !state.enabled && !state.visible);
    expect(await s.show()).toEqual({ success: false });
  });

  it("releases renderer handlers, native window listeners, settings subscriptions, drag timers and overlay", async () => {
    const s = await createScenario();
    await s.show();
    const mainWindow = s.platform.windows.windows[0];
    const overlay = s.platform.windows.windows[1];
    jest.useFakeTimers({ doNotFake: ["queueMicrotask", "setImmediate"] });
    await s.platform.rendererIpc.invoke(
      "eden-keyboard:start-drag",
      overlay.webContents.id,
      { input: "system-cursor", point: { x: 0, y: 0, space: "screen" } },
    );
    expect(jest.getTimerCount()).toBe(1);
    expect(s.boundsChanged.hasListeners()).toBe(true);
    expect(s.stopped.hasListeners()).toBe(true);
    expect(s.settings.changed.hasListeners()).toBe(true);
    await s.runtime.dispose();
    expect(s.boundsChanged.hasListeners()).toBe(false);
    expect(s.stopped.hasListeners()).toBe(false);
    expect(s.settings.changed.hasListeners()).toBe(false);
    expect(s.platform.rendererIpc.registrationCount).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
    expect(mainWindow.listenerCount("move")).toBe(0);
    expect(mainWindow.listenerCount("resize")).toBe(0);
    expect(mainWindow.listenerCount("closed")).toBe(0);
    expect(overlay.isDestroyed()).toBe(true);
    expect(s.lift()).toBe(0);
    await expect(s.state()).rejects.toThrow("No IPC handler registered");
    mainWindow.emit("resize");
    expect(s.platform.windows.windows).toHaveLength(2);
  });

  it("rejects input to a destroyed target view and clears keyboard focus", async () => {
    const targetPlatform = new InMemoryPlatform("/tmp");
    const target = targetPlatform.windows.createView({ webPreferences: {} });
    const zoom = target.webContents.getZoomFactor.bind(target.webContents);
    target.webContents.getZoomFactor = () => {
      if (target.webContents.isDestroyed())
        throw new Error("Object has been destroyed");
      return zoom();
    };
    const info: ViewInfo = {
      id: 17,
      view: target,
      appId: "com.example.keyboard-target",
      manifest: testApp("com.example.keyboard-target"),
      bounds: { x: 0, y: 0, width: 1280, height: 800 },
      requestedVisible: true,
      visible: true,
      mode: "floating",
      viewType: "app",
    };
    const views = createKeyboardViews({
      getAppIdByWebContentsId: () => info.appId,
      getViewIdByWebContentsId: () => info.id,
      getViewInfo: () => info,
      getAllViews: () => [[info.id, info]],
      sendToView: () => !target.webContents.isDestroyed(),
      setKeyboardPresentationLift: () => undefined,
      globalBoundsChanged: createEvent(),
    });
    const nativeEvents = new EventEmitter();
    const s = await createScenario(
      {},
      (platform) => {
        const on = platform.rendererIpc.on.bind(platform.rendererIpc);
        platform.rendererIpc.on = (channel, listener) => {
          on(channel, listener);
          nativeEvents.on(channel, listener);
        };
      },
      views,
    );
    try {
      nativeEvents.emit(
        "eden-keyboard:focus-state",
        { sender: { id: target.webContents.id } },
        {
          visible: true,
          sessionId: 1,
          target: { kind: "input", inputType: "text" },
        },
      );
      await waitForState(
        s,
        (state) => state.visible && state.target?.kind === "input",
      );
      target.webContents.close();
      const overlay = s.platform.windows.windows[1];
      await expect(
        s.platform.rendererIpc.invoke(
          "eden-keyboard:send-action",
          overlay.webContents.id,
          { type: "insertText", text: "lost" },
        ),
      ).resolves.toEqual({ success: false });
      expect(await s.state()).toMatchObject({ visible: false });
      expect((await s.state()).target).toBeUndefined();
    } finally {
      target.webContents.close();
      nativeEvents.removeAllListeners();
    }
  });

  it("preserves native failure details when attaching the main window", async () => {
    const s = await createScenario();
    const cause = new Error("Native window listener registration failed");
    s.mainWindow.on = () => {
      throw cause;
    };
    const failure = await s.runtime.run(
      Effect.flip(s.keyboard.setMainWindow(s.mainWindow)),
    );
    expect(failure).toMatchObject({
      _tag: "KeyboardNativeFailure",
      operation: "attach-main-window",
      message: cause.message,
    });
    expect(failure.cause).toBe(cause);
  });

  it("rejects renderer actions and drag control from outside the keyboard window", async () => {
    const s = await createScenario();
    for (const [channel, payload, message] of [
      [
        "send-action",
        { type: "insertText", text: "untrusted" },
        "Only the keyboard window can dispatch keyboard actions",
      ],
      [
        "start-drag",
        { input: "system-cursor", point: { x: 0, y: 0, space: "screen" } },
        "Only the keyboard window can start keyboard drag",
      ],
      ["end-drag", undefined, "Only the keyboard window can end keyboard drag"],
    ] as const) {
      await expect(
        s.platform.rendererIpc.invoke(
          `eden-keyboard:${channel}`,
          s.mainWindow.webContents.id,
          payload,
        ),
      ).rejects.toThrow(message);
    }
    expect(await s.state()).toMatchObject({ visible: false });
  });

  it("drains an uncancellable native renderer load before destroying its overlay", async () => {
    let entered!: () => void;
    let finish!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const loaded = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const s = await createScenario({}, (platform) => {
      const createWindow = platform.windows.createWindow.bind(platform.windows);
      platform.windows.createWindow = (options) => {
        const window = createWindow(options);
        if (options.parent) {
          const loadFile = window.loadFile.bind(window);
          window.loadFile = async (file) => {
            entered();
            await loaded;
            await loadFile(file);
          };
        }
        return window;
      };
    });
    await started;
    const overlay = s.platform.windows.windows[1];
    let disposed = false;
    const disposing = s.runtime.dispose().then(() => {
      disposed = true;
    });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(disposed).toBe(false);
      expect(overlay.isDestroyed()).toBe(false);
    } finally {
      finish();
      await disposing;
    }
    expect(overlay.isDestroyed()).toBe(true);
  });
});
