import type {
  ContextMenuOpenArgs,
  ContextMenuOpenEvent,
  ContextMenuPosition,
  ContextMenuResult,
} from "@edenapp/types";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { TargetedNotification } from "../controllers/events";
import type { Event } from "../events/event";
import { scopedEvent } from "../events/scoped";
import { log } from "../logging/logger";
import {
  ContextMenuCallerRejected,
  type ContextMenuCloseFailure,
  type ContextMenuOpenFailure,
  type ContextMenuViewReadFailed,
} from "./errors";
import type { ContextMenuCaller } from "./ports";
import { ContextMenuViews } from "./ports";

export interface ContextMenu {
  registerDisplayProvider: (
    caller: ContextMenuCaller,
  ) => Effect.Effect<{ success: boolean }, ContextMenuCallerRejected>;
  openMenu: (
    args: ContextMenuOpenArgs,
    caller?: ContextMenuCaller,
  ) => Effect.Effect<{ requestId: string }, ContextMenuOpenFailure>;
  resolveMenu: (
    result: ContextMenuResult,
  ) => Effect.Effect<{ success: boolean }, ContextMenuViewReadFailed>;
  closeMenu: (
    requestId: string | undefined,
    caller?: ContextMenuCaller,
  ) => Effect.Effect<{ success: boolean }, ContextMenuCloseFailure>;
  opened: Event<TargetedNotification<{ menu: ContextMenuOpenEvent }>>;
  closed: Event<TargetedNotification<ContextMenuResult>>;
}

export const ContextMenu = Context.Service<"eden/ContextMenu", ContextMenu>(
  "eden/ContextMenu",
);

interface Request {
  requestId: string;
  opener: { appId: string; viewId: number };
}

export const ContextMenuLive = Layer.effect(
  ContextMenu,
  Effect.gen(function* () {
    const views = yield* ContextMenuViews;
    let idCounter = 0;
    let activeRequest: Request | null = null;
    let provider: { appId: string; viewId: number } | null = null;
    const opened =
      yield* scopedEvent<
        TargetedNotification<{ menu: ContextMenuOpenEvent }>
      >();
    const closed =
      yield* scopedEvent<TargetedNotification<ContextMenuResult>>();
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        activeRequest = null;
        provider = null;
      }),
    );

    function resolveCallerViewId(webContentsId?: number) {
      if (webContentsId === undefined) return undefined;
      const viewId = views.resolve(webContentsId);
      if (viewId === undefined)
        log.warn(
          `Context menu caller view not found for webContents ${webContentsId}`,
        );
      return viewId;
    }

    function currentProvider() {
      return Effect.gen(function* () {
        return provider && (yield* views.get(provider.viewId))?.alive
          ? provider
          : null;
      });
    }

    function audience(openerViewId: number) {
      return Effect.map(currentProvider(), (display) =>
        display ? [display.viewId, openerViewId] : [openerViewId],
      );
    }

    function registerDisplayProvider(caller: ContextMenuCaller) {
      return Effect.gen(function* () {
        const viewId = resolveCallerViewId(caller.webContentsId);
        if (viewId === undefined || !caller.appId)
          return yield* Effect.fail(
            new ContextMenuCallerRejected({
              operation: "register-display",
              appId: caller?.appId,
              webContentsId: caller?.webContentsId,
              message: "Context menu display provider must be a valid view",
            }),
          );
        provider = { appId: caller.appId, viewId };
        log.info(`Context menu display provider registered: ${caller.appId}`);
        return { success: true };
      });
    }

    function toGlobalPosition(position: ContextMenuPosition, viewId: number) {
      return Effect.gen(function* () {
        const view = yield* views.get(viewId);
        if (!view) return position;
        const { bounds, scale } = view;
        const window = views.windowSize();
        return {
          left:
            position.left !== undefined
              ? position.left * scale + bounds.x
              : undefined,
          top:
            position.top !== undefined
              ? position.top * scale + bounds.y
              : undefined,
          right:
            position.right !== undefined
              ? position.right * scale +
                window.width -
                (bounds.x + bounds.width)
              : undefined,
          bottom:
            position.bottom !== undefined
              ? position.bottom * scale +
                window.height -
                (bounds.y + bounds.height)
              : undefined,
        };
      });
    }

    function openMenu(args: ContextMenuOpenArgs, caller?: ContextMenuCaller) {
      return Effect.gen(function* () {
        if (!caller?.appId)
          return yield* Effect.fail(
            new ContextMenuCallerRejected({
              operation: "open",
              appId: caller?.appId,
              webContentsId: caller?.webContentsId,
              message: "Caller app ID is required to open context menus",
            }),
          );
        const viewId = resolveCallerViewId(caller.webContentsId);
        if (viewId === undefined)
          return yield* Effect.fail(
            new ContextMenuCallerRejected({
              operation: "open",
              appId: caller?.appId,
              webContentsId: caller?.webContentsId,
              message: "Context menus can only be opened from a renderer view",
            }),
          );
        if (viewId === (yield* currentProvider())?.viewId)
          return yield* Effect.fail(
            new ContextMenuCallerRejected({
              operation: "open",
              appId: caller?.appId,
              webContentsId: caller?.webContentsId,
              message: "Display provider cannot open context menus",
            }),
          );
        const requestId = `ctx-${Date.now()}-${++idCounter}`;
        if (activeRequest) {
          const previous = activeRequest;
          activeRequest = null;
          closed.emit({
            payload: { requestId: previous.requestId, reason: "replaced" },
            viewIds: yield* audience(previous.opener.viewId),
          });
        }
        activeRequest = { requestId, opener: { appId: caller.appId, viewId } };
        const menu: ContextMenuOpenEvent = {
          requestId,
          title: args.title,
          position: yield* toGlobalPosition(args.position, viewId),
          items: args.items,
        };
        opened.emit({ payload: { menu }, viewIds: yield* audience(viewId) });
        log.info(`Context menu opened (${requestId})`);
        return { requestId };
      });
    }

    function resolveMenu(result: ContextMenuResult) {
      return Effect.gen(function* () {
        if (!activeRequest || activeRequest.requestId !== result.requestId)
          return { success: false };
        const openerViewId = activeRequest.opener.viewId;
        activeRequest = null;
        closed.emit({
          payload: result,
          viewIds: yield* audience(openerViewId),
        });
        return { success: true };
      });
    }

    function closeMenu(
      requestId: string | undefined,
      caller?: ContextMenuCaller,
    ) {
      return Effect.gen(function* () {
        if (!activeRequest) return { success: false };
        const targetId = requestId ?? activeRequest.requestId;
        if (targetId !== activeRequest.requestId) return { success: false };
        if (!caller?.appId)
          return yield* Effect.fail(
            new ContextMenuCallerRejected({
              operation: "close",
              appId: caller?.appId,
              webContentsId: caller?.webContentsId,
              requestId: targetId,
              message: "Caller app ID is required to close context menus",
            }),
          );
        const callerViewId = resolveCallerViewId(caller.webContentsId);
        if (
          callerViewId === undefined ||
          callerViewId !== activeRequest.opener.viewId
        ) {
          log.warn(
            `Context menu close denied for ${caller.appId} (request ${targetId})`,
          );
          return yield* Effect.fail(
            new ContextMenuCallerRejected({
              operation: "close",
              appId: caller?.appId,
              webContentsId: caller?.webContentsId,
              requestId: targetId,
              message: "Only the original opener can close this menu",
            }),
          );
        }
        const openerViewId = activeRequest.opener.viewId;
        activeRequest = null;
        closed.emit({
          payload: { requestId: targetId, reason: "close" },
          viewIds: yield* audience(openerViewId),
        });
        return { success: true };
      });
    }

    return {
      registerDisplayProvider,
      openMenu,
      resolveMenu,
      closeMenu,
      opened,
      closed,
    };
  }),
);
