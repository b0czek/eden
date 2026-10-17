import type { ViewBounds } from "@edenapp/types";
import * as Effect from "effect/Effect";
import { log } from "../logging";
import type { DisplayPort } from "../platform/ports";
import { createPointerTracking } from "./pointer";
import {
  calculateResizeBounds,
  type ResizeConstraints,
  type ResizeDirection,
} from "./resize-geometry";
import type { Views } from "./service";
export const createViewInteractions = Effect.fn(function* (
  _views: Views,
  display: DisplayPort,
) {
  const _pointer = yield* createPointerTracking(display, 8);
  let _dragState: {
    appId: string;
    startX: number;
    startY: number;
    startBounds: ViewBounds;
  } | null = null;
  let _resizeState: {
    appId: string;
    startX: number;
    startY: number;
    startBounds: ViewBounds;
    direction: ResizeDirection;
    constraints: ResizeConstraints;
  } | null = null;
  function getViewIdByAppId(appId: string) {
    const viewIds = _views.getViewsByAppId(appId);
    if (viewIds.length === 0) {
      throw new Error(`App ${appId} is not running`);
    }
    return viewIds[0];
  }
  function startDragForApp(appId: string, startX: number, startY: number) {
    const viewId = getViewIdByAppId(appId);

    // Get current view bounds
    const viewInfo = _views.getViewInfo(viewId);
    if (!viewInfo) {
      throw new Error(`View ${viewId} not found`);
    }

    // Stop any existing drag
    if (_dragState) {
      _pointer.unsubscribe(`drag-${_dragState.appId}`);
    }

    // Start tracking global mouse position
    _dragState = {
      appId,
      startX,
      startY,
      startBounds: { ...viewInfo.bounds },
    };

    // Subscribe to mouse updates
    _pointer.subscribe(`drag-${appId}`, (position) => {
      if (!_dragState) return;

      const deltaX = position.x - _dragState.startX;
      const deltaY = position.y - _dragState.startY;

      const newBounds = {
        x: _dragState.startBounds.x + deltaX,
        y: _dragState.startBounds.y + deltaY,
        width: _dragState.startBounds.width,
        height: _dragState.startBounds.height,
      };

      _views.setViewBounds(viewId, newBounds, { notify: true });
    });
  }
  function endDragForApp(appId?: string) {
    if (!_dragState) {
      return;
    }
    if (appId && _dragState.appId !== appId) {
      throw new Error("Drag state does not belong to caller");
    }
    _pointer.unsubscribe(`drag-${_dragState.appId}`);
    _dragState = null;
  }
  function startResizeForApp(
    appId: string,
    startX: number,
    startY: number,
    direction: ResizeDirection,
  ) {
    const viewId = getViewIdByAppId(appId);

    // Get current view bounds
    const viewInfo = _views.getViewInfo(viewId);
    if (!viewInfo) {
      throw new Error(`View ${viewId} not found`);
    }

    // Stop any existing resize
    if (_resizeState) {
      _pointer.unsubscribe(`resize-${_resizeState.appId}`);
    }

    const interfaceScale =
      viewInfo.manifest.window?.scaling === "manual"
        ? 1
        : _views.getCurrentScale();
    const windowConfig = viewInfo.manifest.window;
    const scaled = (value: number) => Math.round(value * interfaceScale);

    // Initialize resize state
    _resizeState = {
      appId,
      startX,
      startY,
      startBounds: { ...viewInfo.bounds },
      direction,
      constraints: {
        minWidth: scaled(windowConfig?.minSize?.width || 200),
        minHeight: scaled(windowConfig?.minSize?.height || 200),
        maxWidth: windowConfig?.maxSize?.width
          ? scaled(windowConfig.maxSize.width)
          : undefined,
        maxHeight: windowConfig?.maxSize?.height
          ? scaled(windowConfig.maxSize.height)
          : undefined,
      },
    };

    // Subscribe to mouse updates
    _pointer.subscribe(`resize-${appId}`, (position) => {
      if (!_resizeState) return;

      const deltaX = position.x - _resizeState.startX;
      const deltaY = position.y - _resizeState.startY;

      const newBounds = calculateResizeBounds(
        _resizeState.startBounds,
        deltaX,
        deltaY,
        _resizeState.direction,
        _resizeState.constraints,
      );

      _views.setViewBounds(viewId, newBounds, { notify: true });
    });
  }
  function endResizeForApp(appId?: string) {
    if (!_resizeState) {
      return;
    }
    if (appId && _resizeState.appId !== appId) {
      throw new Error("Resize state does not belong to caller");
    }
    _pointer.unsubscribe(`resize-${_resizeState.appId}`);
    _resizeState = null;
  }
  function handleGlobalMouseUp() {
    // Cleanup any active drag or resize operations when mouse is released
    if (_dragState) {
      log.info("Global mouseup - cleaning up drag state");
      _pointer.unsubscribe(`drag-${_dragState.appId}`);
      _dragState = null;
    }
    if (_resizeState) {
      log.info("Global mouseup - cleaning up resize state");
      _pointer.unsubscribe(`resize-${_resizeState.appId}`);
      _resizeState = null;
    }
    return { success: true };
  }
  function dispose() {
    _dragState = null;
    _resizeState = null;
  }
  yield* Effect.addFinalizer(() => Effect.sync(dispose));
  return {
    startDrag: startDragForApp,
    endDrag: endDragForApp,
    startResize: startResizeForApp,
    endResize: endResizeForApp,
    endAll: handleGlobalMouseUp,
  };
});
export type ViewInteractions = Effect.Success<
  ReturnType<typeof createViewInteractions>
>;
