import type {
  EdenKeyboardInsetState,
  EdenKeyboardPlacementMode,
  EdenKeyboardState,
  ViewBounds,
} from "@edenapp/types";
import {
  calculateDefaultFloatingKeyboardBounds,
  calculateDockedKeyboardBounds,
  calculateDockedKeyboardLift,
  calculateKeyboardLayout,
  KEYBOARD_COMPACT_DESIRED_WIDTH,
  KEYBOARD_COMPACT_MIN_WIDTH,
} from "./geometry";
import type { KeyboardViews } from "./ports";
import type { KeyboardState } from "./state";

export function effectivePlacement(
  state: KeyboardState,
): EdenKeyboardPlacementMode {
  if (state.persistentVisibility) return "floating";
  return state.currentTarget?.placementMode ?? state.preferences.placementMode;
}

function geometryOptions(state: KeyboardState) {
  const compact =
    calculateKeyboardLayout(state.currentTarget?.target) === "number";
  return {
    rowCount: compact ? 4 : state.preferences.showNumberRow ? 5 : 4,
    scale: state.preferences.interfaceScale,
    ...(compact
      ? {
          desiredWidth: KEYBOARD_COMPACT_DESIRED_WIDTH,
          minWidth: KEYBOARD_COMPACT_MIN_WIDTH,
        }
      : {}),
  };
}

export const defaultContentBounds = (): ViewBounds => ({
  x: 0,
  y: 0,
  width: 1280,
  height: 800,
});

export function dockedKeyboardBounds(
  state: KeyboardState,
  contentBounds: ViewBounds,
) {
  return calculateDockedKeyboardBounds(
    contentBounds,
    state.workspaceBounds,
    geometryOptions(state),
  );
}

export function keyboardBounds(
  state: KeyboardState,
  contentBounds: ViewBounds,
): ViewBounds {
  if (effectivePlacement(state) === "docked")
    return dockedKeyboardBounds(state, contentBounds);
  const defaults = calculateDefaultFloatingKeyboardBounds(
    contentBounds,
    state.workspaceBounds,
    geometryOptions(state),
  );
  return state.floatingBounds
    ? {
        ...state.floatingBounds,
        width: defaults.width,
        height: defaults.height,
      }
    : defaults;
}

export function keyboardState(
  state: KeyboardState,
  visible: boolean,
  contentBounds: ViewBounds,
): EdenKeyboardState {
  const placementMode = effectivePlacement(state);
  const inset: EdenKeyboardInsetState = {
    visible,
    placementMode,
    bottomInset:
      state.preferences.enabled && placementMode === "docked" && visible
        ? dockedKeyboardBounds(state, contentBounds).height
        : 0,
  };
  return {
    ...inset,
    target: state.currentTarget?.target,
    layout: calculateKeyboardLayout(state.currentTarget?.target),
    enabled: state.preferences.enabled,
    showNumberRow: state.preferences.showNumberRow,
  };
}

export function workspaceLift(
  state: KeyboardState,
  visible: boolean,
  contentBounds: ViewBounds,
  views: KeyboardViews,
): number {
  if (
    !state.preferences.enabled ||
    effectivePlacement(state) !== "docked" ||
    !visible ||
    !state.currentTarget
  )
    return 0;
  const targetView = views.get(state.currentTarget.viewId);
  if (!targetView?.visible) return 0;
  return calculateDockedKeyboardLift({
    keyboardHeight: dockedKeyboardBounds(state, contentBounds).height,
    targetBounds: state.currentTarget.targetBounds,
    targetScale: targetView.scale,
    viewBounds: targetView.bounds,
    contentBounds,
  });
}
