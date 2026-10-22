import type { EdenKeyboardPlacementMode, ViewBounds } from "@edenapp/types";
import * as Effect from "effect/Effect";
import { scopedEvent } from "../../core/events/scoped";
import type { PlatformWindow, WindowingPort } from "../../platform/ports/types";
import { KeyboardNativeFailure } from "./errors";
import { defaultContentBounds } from "./placement";
import type { KeyboardAssets } from "./ports";

const native = <A>(
  operation: KeyboardNativeFailure["operation"],
  work: () => A,
) =>
  Effect.try({
    try: work,
    catch: (cause) => new KeyboardNativeFailure({ operation, cause }),
  });

interface OverlayDependencies {
  windows: Pick<WindowingPort, "createWindow">;
  assets: KeyboardAssets;
  schedule(
    work: Effect.Effect<void, KeyboardNativeFailure>,
    label: string,
  ): void;
}

/** Own the native overlay and every listener attached to either native window. */
export function createKeyboardOverlay({
  windows,
  assets,
  schedule,
}: OverlayDependencies) {
  return Effect.gen(function* () {
    let mainWindow: PlatformWindow | null = null;
    let keyboardWindow: PlatformWindow | null = null;
    let mainListeners: (() => void) | undefined;
    let overlayListeners: (() => void) | undefined;
    const { frontendPath, preloadPath } = assets;
    const loaded = yield* scopedEvent<void>();
    const moved = yield* scopedEvent<void>();
    const closed = yield* scopedEvent<void>();
    const mainBoundsChanged = yield* scopedEvent<void>();

    function get() {
      return keyboardWindow && !keyboardWindow.isDestroyed()
        ? keyboardWindow
        : undefined;
    }

    function releaseWindow() {
      overlayListeners?.();
      overlayListeners = undefined;
      const current = keyboardWindow;
      keyboardWindow = null;
      if (current && !current.isDestroyed()) current.close();
    }

    function setMainWindow(window: PlatformWindow) {
      return native("attach-main-window", () => {
        mainListeners?.();
        mainWindow = window;
        const onBounds = () => mainBoundsChanged.emit();
        const onClosed = () => {
          mainWindow = null;
          closed.emit();
          releaseWindow();
        };
        window.on("move", onBounds);
        window.on("resize", onBounds);
        window.on("closed", onClosed);
        mainListeners = () => {
          window.removeListener("move", onBounds);
          window.removeListener("resize", onBounds);
          window.removeListener("closed", onClosed);
        };
      });
    }

    function ensure(scale: number, placementMode: EdenKeyboardPlacementMode) {
      return Effect.gen(function* () {
        if (!mainWindow || mainWindow.isDestroyed()) return undefined;
        const parent = mainWindow;
        const existing = get();
        if (existing) return existing;
        if (!(yield* assets.available)) return undefined;
        return yield* native("create-overlay", () => {
          const window = windows.createWindow({
            parent,
            show: false,
            frame: false,
            transparent: true,
            backgroundColor: "#00000000",
            resizable: false,
            movable: true,
            minimizable: false,
            maximizable: false,
            fullscreenable: false,
            skipTaskbar: true,
            focusable: false,
            hasShadow: false,
            webPreferences: {
              nodeIntegration: false,
              contextIsolation: true,
              sandbox: false,
              preload: preloadPath,
              backgroundThrottling: false,
              scrollBounce: false,
              spellcheck: false,
            },
          });
          keyboardWindow = window;
          window.setAlwaysOnTop(true, "screen-saver");
          window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
          window.webContents.setZoomFactor(scale);
          window.setMovable(placementMode === "floating");
          window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
          const onLoaded = () => loaded.emit();
          const onClosed = () => {
            if (keyboardWindow === window) {
              closed.emit();
              keyboardWindow = null;
            }
            overlayListeners?.();
            overlayListeners = undefined;
          };
          const onMoved = () => moved.emit();
          window.webContents.on("did-finish-load", onLoaded);
          window.on("closed", onClosed);
          window.on("move", onMoved);
          overlayListeners = () => {
            window.webContents.removeListener("did-finish-load", onLoaded);
            window.removeListener("closed", onClosed);
            window.removeListener("move", onMoved);
          };
          schedule(
            Effect.tryPromise({
              try: () => window.loadFile(frontendPath),
              catch: (cause) =>
                new KeyboardNativeFailure({
                  operation: "load-frontend",
                  cause,
                }),
            }).pipe(Effect.uninterruptible),
            "Failed to load keyboard window frontend:",
          );
          return window;
        });
      });
    }

    const bounds = () => get()?.getBounds();
    const visible = () => get()?.isVisible() ?? false;
    const contentBounds = () =>
      mainWindow?.getContentBounds() ?? defaultContentBounds();
    const isSender = (id: number) => id === get()?.webContents.id;
    const scale = (value: number) =>
      native("set-scale", () => {
        get()?.webContents.setZoomFactor(value);
      });
    const position = (value: ViewBounds) =>
      native("set-bounds", () => {
        get()?.setBounds(value);
      });
    const movable = (value: boolean) =>
      native("set-movable", () => {
        get()?.setMovable(value);
      });
    const show = () =>
      native("show", () => {
        const window = get();
        if (window && !window.isVisible()) window.showInactive();
      });
    const hide = () =>
      native("hide", () => {
        get()?.hide();
      });
    const send = (channel: string, value: unknown) =>
      native("send-state", () => {
        get()?.webContents.send(channel, value);
      });

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        mainListeners?.();
        mainListeners = undefined;
        releaseWindow();
        mainWindow = null;
      }),
    );

    return {
      setMainWindow,
      ensure,
      bounds,
      visible,
      contentBounds,
      isSender,
      scale,
      position,
      movable,
      show,
      hide,
      send,
      loaded,
      moved,
      closed,
      mainBoundsChanged,
    };
  });
}

export type KeyboardOverlay = Effect.Success<
  ReturnType<typeof createKeyboardOverlay>
>;
