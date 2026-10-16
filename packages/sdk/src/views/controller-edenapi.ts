import * as v from "valibot";
import { command, defineController } from "../controllers/controller";
import { targetedEvent } from "../controllers/events";
import type { CommandCallerContext } from "../execution/context";
import type { ViewInteractions } from "./interactions";
import { interfaceScaleSchema, viewBoundsSchema } from "./schemas";
import type { Views } from "./service";

const appIdSchema = v.object({ appId: v.pipe(v.string(), v.nonEmpty()) });
const modeSchema = v.optional(v.picklist(["floating", "tiled"]));
const directionSchema = v.object({
  direction: v.picklist(["left", "right", "top", "bottom"]),
});
const pointSchema = v.object({ startX: v.number(), startY: v.number() });

export function createViewController(
  views: Views,
  interactions: ViewInteractions,
) {
  const success = () => ({ success: true });
  function ownApp(caller: CommandCallerContext) {
    if (!caller.appId)
      throw new Error("Caller app context is required for this endpoint");
    return caller.appId;
  }
  function viewId(appId: string) {
    const id = views.getViewsByAppId(appId)[0];
    if (id === undefined) throw new Error(`App ${appId} is not running`);
    return id;
  }
  function visibility(appId: string, visible: boolean) {
    const id = viewId(appId);
    if (visible) views.showView(id);
    else views.hideView(id);
    return success();
  }
  function focus(appId: string) {
    const id = viewId(appId);
    views.showView(id);
    views.focusView(id);
    return success();
  }
  return defineController("view", {
    commands: {
      "update-bounds": command({
        input: v.object({ bounds: viewBoundsSchema }),
        handle: ({ bounds }, caller) => {
          views.setViewBounds(viewId(ownApp(caller)), bounds, { notify: true });
          return success();
        },
      }),
      "update-view-bounds": command({
        permission: "manage",
        input: v.object({
          appId: appIdSchema.entries.appId,
          bounds: viewBoundsSchema,
        }),
        handle: ({ appId, bounds }) => {
          views.setViewBounds(viewId(appId), bounds);
          return success();
        },
      }),
      "set-visibility": command({
        input: v.object({ visible: v.boolean() }),
        handle: ({ visible }, caller) => visibility(ownApp(caller), visible),
      }),
      "set-view-visibility": command({
        permission: "manage",
        input: v.object({
          appId: appIdSchema.entries.appId,
          visible: v.boolean(),
        }),
        handle: ({ appId, visible }) => visibility(appId, visible),
      }),
      focus: command({ handle: (_, caller) => focus(ownApp(caller)) }),
      "focus-view": command({
        permission: "manage",
        input: appIdSchema,
        handle: ({ appId }) => focus(appId),
      }),
      "update-global-bounds": command({
        permission: "manage",
        input: v.object({
          bounds: viewBoundsSchema,
          windowSize: v.object({ width: v.number(), height: v.number() }),
        }),
        handle: ({ bounds, windowSize }) => {
          views.updateGlobalBounds(bounds, windowSize);
          return success();
        },
      }),
      "toggle-mode": command({
        input: v.object({ mode: modeSchema }),
        handle: ({ mode }, caller) => {
          views.setViewMode(viewId(ownApp(caller)), mode);
          return success();
        },
      }),
      "toggle-view-mode": command({
        permission: "manage",
        input: v.object({ appId: appIdSchema.entries.appId, mode: modeSchema }),
        handle: ({ appId, mode }) => {
          views.setViewMode(viewId(appId), mode);
          return success();
        },
      }),
      "tile-layout-state": command({
        handle: (_, caller) => views.getTileLayoutState(viewId(ownApp(caller))),
      }),
      "swap-tile": command({
        input: directionSchema,
        handle: ({ direction }, caller) =>
          views.swapTiledView(viewId(ownApp(caller)), direction),
      }),
      "expand-tile": command({
        input: directionSchema,
        handle: ({ direction }, caller) =>
          views.expandTiledView(viewId(ownApp(caller)), direction),
      }),
      "start-drag": command({
        input: pointSchema,
        handle: ({ startX, startY }, caller) => {
          interactions.startDrag(ownApp(caller), startX, startY);
          return success();
        },
      }),
      "end-drag": command({
        handle: (_, caller) => {
          interactions.endDrag(ownApp(caller));
          return success();
        },
      }),
      "global-mouseup": command({
        permission: "manage",
        handle: () => interactions.endAll(),
      }),
      "start-resize": command({
        input: v.object({
          ...pointSchema.entries,
          direction: v.optional(
            v.picklist([
              "left",
              "right",
              "bottom",
              "bottom-left",
              "bottom-right",
            ]),
          ),
        }),
        handle: ({ startX, startY, direction }, caller) => {
          interactions.startResize(
            ownApp(caller),
            startX,
            startY,
            direction ?? "bottom-right",
          );
          return success();
        },
      }),
      "end-resize": command({
        handle: (_, caller) => {
          interactions.endResize(ownApp(caller));
          return success();
        },
      }),
      "window-size": command({ handle: () => views.getWindowSize() }),
      "set-interface-scale": command({
        input: v.object({
          scale: v.pipe(
            v.string(),
            v.transform(parseFloat),
            interfaceScaleSchema,
          ),
        }),
        handle: ({ scale }) => {
          views.setInterfaceScale(scale);
          return success();
        },
      }),
      "get-interface-scale": command({
        handle: () => ({ scale: views.getCurrentScale() }),
      }),
    },
    events: {
      "view-removed": views.viewRemoved,
      "view-loaded": views.viewLoaded,
      "view-load-failed": views.viewLoadFailed,
      "interface-scale-changed": views.interfaceScaleChanged,
      "global-bounds-changed": views.globalBoundsChanged,
      "bounds-updated": targetedEvent(views.boundsUpdated),
      "mode-changed": targetedEvent(views.modeChanged),
    },
  });
}
