import type {
  EdenKeyboardAction,
  EdenKeyboardFocusState,
} from "@edenapp/types";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import { listen } from "../events/scoped";
import { log } from "../logging/logger";
import {
  DisplayPort,
  type PlatformWindow,
  RendererIpcPort,
  WindowingPort,
} from "../platform/ports/types";

import { Processes } from "../processes/service";
import { EDEN_SETTINGS_APP_ID } from "../settings/constants";
import { Settings } from "../settings/service";
import { createKeyboardDrag } from "./drag";
import { type KeyboardNativeFailure, KeyboardSenderRejected } from "./errors";
import { bindKeyboardIpc } from "./ipc";
import {
  effectivePlacement,
  keyboardBounds,
  keyboardState,
  workspaceLift,
} from "./placement";
import { KeyboardAssets, KeyboardViews } from "./ports";
import { keyboardChannels as channel } from "./protocol";
import {
  defaultKeyboardPreferences,
  KEYBOARD_SETTINGS,
  parseInterfaceScale,
  parsePlacementMode,
  readKeyboardPreferences,
} from "./settings";
import type { KeyboardState } from "./state";
import { createKeyboardOverlay } from "./window";

export interface Keyboard {
  initialize: () => Effect.Effect<void>;
  setMainWindow: (
    window: PlatformWindow,
  ) => Effect.Effect<void, KeyboardNativeFailure>;
}

export const Keyboard = Context.Service<"eden/Keyboard", Keyboard>(
  "eden/Keyboard",
);

export const KeyboardLive = Layer.effect(
  Keyboard,
  Effect.gen(function* () {
    const assets = yield* KeyboardAssets;
    const settings = yield* Settings;
    const views = yield* KeyboardViews;
    const processes = yield* Processes;
    const windows = yield* WindowingPort;
    const rendererIpc = yield* RendererIpcPort;
    const display = yield* DisplayPort;
    const state: KeyboardState = {
      preferences: defaultKeyboardPreferences(),
      workspaceBounds: null,
      currentTarget: null,
      persistentVisibility: false,
      dismissedTarget: null,
      floatingBounds: null,
      visibilityRequested: false,
    };
    let disposed = false;
    const pending = yield* Queue.unbounded<{
      work: Effect.Effect<void, KeyboardNativeFailure>;
      label: string;
    }>();
    function schedule(
      work: Effect.Effect<void, KeyboardNativeFailure>,
      label: string,
    ) {
      if (!disposed) Queue.offerUnsafe(pending, { work, label });
    }
    const overlay = yield* createKeyboardOverlay({ windows, assets, schedule });
    const drag = yield* createKeyboardDrag({
      state,
      overlay,
      display,
      schedule,
    });
    yield* Effect.forkScoped(
      Effect.forever(
        Effect.gen(function* () {
          const { work, label } = yield* Queue.take(pending);
          yield* Effect.catchCause(work, (cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.failCause(cause)
              : Effect.sync(() => log.error(label, Cause.squash(cause))),
          );
        }),
      ),
    );

    function currentState() {
      return keyboardState(state, overlay.visible(), overlay.contentBounds());
    }

    function notifyStateChanged() {
      return Effect.gen(function* () {
        const value = currentState();
        yield* overlay.send(channel.stateChanged, value);
        yield* Effect.sync(() => {
          for (const viewId of views.list())
            views.send(viewId, channel.stateChanged, value);
        });
      });
    }

    function updateWorkspacePresentation() {
      return Effect.sync(() =>
        views.setPresentationLift(
          workspaceLift(
            state,
            overlay.visible(),
            overlay.contentBounds(),
            views,
          ),
        ),
      );
    }

    function ensureWindow() {
      return overlay.ensure(
        state.preferences.interfaceScale,
        effectivePlacement(state),
      );
    }

    function refreshPresentation() {
      return Effect.gen(function* () {
        const window = yield* ensureWindow();
        if (window) {
          yield* overlay.movable(effectivePlacement(state) === "floating");
          yield* overlay.position(
            keyboardBounds(state, overlay.contentBounds()),
          );
        }
        yield* updateWorkspacePresentation();
        yield* notifyStateChanged();
      });
    }

    function showKeyboard() {
      return Effect.gen(function* () {
        const window = yield* ensureWindow();
        if (!window) return;
        if (!state.preferences.enabled) {
          yield* updateWorkspacePresentation();
          yield* notifyStateChanged();
          return;
        }
        state.visibilityRequested = true;
        yield* overlay.movable(effectivePlacement(state) === "floating");
        yield* overlay.position(keyboardBounds(state, overlay.contentBounds()));
        yield* overlay.show();
        yield* updateWorkspacePresentation();
        yield* notifyStateChanged();
      });
    }

    function hideKeyboard() {
      return Effect.gen(function* () {
        state.visibilityRequested = false;
        if (!overlay.bounds()) {
          yield* updateWorkspacePresentation();
          return;
        }
        yield* overlay.hide();
        yield* updateWorkspacePresentation();
        yield* notifyStateChanged();
      });
    }

    function focus(
      sender: number,
      payload: EdenKeyboardFocusState | undefined,
    ) {
      return Effect.gen(function* () {
        if (!payload || typeof payload.visible !== "boolean") return;
        const owner = views.resolve(sender);
        if (!owner) return;
        if (!payload.visible) {
          if (state.currentTarget?.viewId === owner.viewId) {
            state.currentTarget = null;
            yield* state.persistentVisibility
              ? refreshPresentation()
              : hideKeyboard();
          }
          return;
        }
        state.currentTarget = {
          ...owner,
          sessionId: payload.sessionId,
          target: payload.target,
          targetBounds: payload.targetBounds,
          placementMode: payload.placementMode,
        };
        if (!state.preferences.enabled || !state.preferences.autoShowOnFocus)
          return;
        if (
          state.dismissedTarget?.viewId === owner.viewId &&
          state.dismissedTarget.sessionId === payload.sessionId
        )
          return;
        state.dismissedTarget = null;
        yield* showKeyboard();
      });
    }

    function action(sender: number, action: EdenKeyboardAction | undefined) {
      return Effect.gen(function* () {
        if (!action) return { success: false };
        if (!overlay.isSender(sender))
          return yield* Effect.fail(
            new KeyboardSenderRejected({
              sender,
              operation: "dispatch-actions",
            }),
          );
        const target = state.currentTarget;
        if (!target) return { success: false };
        if (!views.get(target.viewId)) {
          state.currentTarget = null;
          yield* hideKeyboard();
          return { success: false };
        }
        const sent = yield* Effect.sync(() =>
          views.send(target.viewId, channel.applyAction, action),
        );
        if (!sent) {
          state.currentTarget = null;
          yield* hideKeyboard();
        }
        return { success: sent };
      });
    }

    function show() {
      return Effect.gen(function* () {
        if (!state.preferences.enabled) return { success: false };
        if (overlay.visible() && state.preferences.placementMode === "docked")
          state.floatingBounds = overlay.bounds() ?? null;
        state.persistentVisibility = true;
        state.dismissedTarget = null;
        yield* showKeyboard();
        return { success: true };
      });
    }

    function hide(_sender: number) {
      return Effect.gen(function* () {
        state.persistentVisibility = false;
        if (state.currentTarget)
          state.dismissedTarget = {
            viewId: state.currentTarget.viewId,
            sessionId: state.currentTarget.sessionId,
          };
        yield* hideKeyboard();
        return { success: true };
      });
    }

    function settingChanged(
      key: string,
      value: string,
    ): Effect.Effect<void, KeyboardNativeFailure> {
      // Commit preferences during notification delivery; queue native presentation.
      const preferences = state.preferences;
      if (key === KEYBOARD_SETTINGS.placementMode) {
        const next = parsePlacementMode(value);
        if (next === preferences.placementMode) return Effect.void;
        preferences.placementMode = next;
        return refreshPresentation();
      }
      if (key === KEYBOARD_SETTINGS.showNumberRow) {
        preferences.showNumberRow = value !== "false";
        return refreshPresentation();
      }
      if (key === KEYBOARD_SETTINGS.interfaceScale) {
        const next = parseInterfaceScale(value);
        if (next === preferences.interfaceScale) return Effect.void;
        preferences.interfaceScale = next;
        return Effect.andThen(overlay.scale(next), refreshPresentation());
      }
      if (key === KEYBOARD_SETTINGS.enabled) {
        const next = value !== "false";
        if (next === preferences.enabled) return Effect.void;
        preferences.enabled = next;
        if (!next) {
          state.persistentVisibility = false;
          state.dismissedTarget = null;
          return hideKeyboard();
        }
        return state.currentTarget && preferences.autoShowOnFocus
          ? showKeyboard()
          : Effect.void;
      }
      if (key === KEYBOARD_SETTINGS.autoShowOnFocus) {
        const next = value !== "false";
        if (next === preferences.autoShowOnFocus) return Effect.void;
        preferences.autoShowOnFocus = next;
        if (!next && overlay.visible() && !state.persistentVisibility)
          return hideKeyboard();
        return next && preferences.enabled && state.currentTarget
          ? showKeyboard()
          : Effect.void;
      }
      return Effect.void;
    }

    function initialize() {
      return Effect.matchEffect(
        Effect.gen(function* () {
          state.preferences = yield* readKeyboardPreferences(settings);
          yield* overlay.scale(state.preferences.interfaceScale);
          yield* refreshPresentation();
        }),
        {
          onFailure: (error) =>
            Effect.sync(() =>
              log.error("Failed to initialize keyboard settings:", error),
            ),
          onSuccess: () => Effect.void,
        },
      );
    }

    function setMainWindow(window: PlatformWindow) {
      return Effect.gen(function* () {
        yield* overlay.setMainWindow(window);
        yield* ensureWindow();
      });
    }

    yield* listen(views.boundsChanged, ({ workspaceBounds }) => {
      state.workspaceBounds = workspaceBounds;
      if (overlay.visible() && effectivePlacement(state) === "docked")
        schedule(
          refreshPresentation(),
          "Failed to reposition keyboard overlay:",
        );
    });
    yield* listen(processes.stopped, ({ appId }) => {
      if (state.currentTarget?.appId !== appId) return;
      state.currentTarget = null;
      state.dismissedTarget = null;
      schedule(
        state.persistentVisibility ? refreshPresentation() : hideKeyboard(),
        "Failed to update keyboard after process stop:",
      );
    });
    yield* listen(settings.changed, ({ appId, key, value }) => {
      if (appId === EDEN_SETTINGS_APP_ID)
        schedule(
          settingChanged(key, value),
          "Failed to update keyboard settings:",
        );
    });
    yield* listen(overlay.loaded, () => {
      schedule(
        Effect.gen(function* () {
          if (state.visibilityRequested && !overlay.visible())
            yield* overlay.show();
          yield* notifyStateChanged();
        }),
        "Failed to initialize keyboard overlay:",
      );
    });
    yield* listen(overlay.moved, () => {
      if (!drag.active() && effectivePlacement(state) === "floating")
        state.floatingBounds = overlay.bounds() ?? null;
    });
    yield* listen(overlay.closed, drag.end);
    yield* listen(overlay.mainBoundsChanged, () => {
      if (overlay.visible() && effectivePlacement(state) === "docked")
        schedule(
          refreshPresentation(),
          "Failed to reposition keyboard overlay:",
        );
    });
    yield* bindKeyboardIpc(rendererIpc, {
      focus,
      action,
      show,
      hide,
      startDrag: drag.start,
      updateDrag: drag.update,
      endDrag: drag.finish,
      state: currentState,
    });
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        disposed = true;
        views.setPresentationLift(0);
      }),
    );

    return { initialize, setMainWindow };
  }).pipe(Effect.tap((value) => value.initialize())),
);
