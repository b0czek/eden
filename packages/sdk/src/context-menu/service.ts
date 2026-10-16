import type {
  ContextMenuOpenArgs,
  ContextMenuOpenEvent,
  ContextMenuPosition,
  ContextMenuResult,
} from "@edenapp/types";
import * as Effect from "effect/Effect";
import type { TargetedNotification } from "../controllers/events";
import { createEvent } from "../events/event";
import { log } from "../logging";
import type { ContextMenuCaller, ContextMenuViews } from "./ports";

interface Request {
  requestId: string;
  opener: { appId: string; viewId: number };
}

const attempt = <A>(work: () => A) =>
  Effect.try({
    try: work,
    catch: (error) =>
      error instanceof Error ? error : new Error(String(error)),
  });

export function createContextMenu({ views }: { views: ContextMenuViews }) {
  return Effect.gen(function* () {
    let idCounter = 0;
    let activeRequest: Request | null = null;
    let provider: { appId: string; viewId: number } | null = null;
    const opened = yield* Effect.acquireRelease(
      Effect.sync(() =>
        createEvent<TargetedNotification<{ menu: ContextMenuOpenEvent }>>(),
      ),
      (event) => Effect.sync(event.dispose),
    );
    const closed = yield* Effect.acquireRelease(
      Effect.sync(() => createEvent<TargetedNotification<ContextMenuResult>>()),
      (event) => Effect.sync(event.dispose),
    );
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
      return provider && views.get(provider.viewId)?.alive ? provider : null;
    }

    function audience(openerViewId: number) {
      const display = currentProvider();
      return display ? [display.viewId, openerViewId] : [openerViewId];
    }

    function registerDisplayProvider(caller: ContextMenuCaller) {
      return attempt((): { success: boolean } => {
        const viewId = resolveCallerViewId(caller.webContentsId);
        if (viewId === undefined || !caller.appId)
          throw new Error("Context menu display provider must be a valid view");
        provider = { appId: caller.appId, viewId };
        log.info(`Context menu display provider registered: ${caller.appId}`);
        return { success: true };
      });
    }

    function toGlobalPosition(
      position: ContextMenuPosition,
      viewId: number,
    ): ContextMenuPosition {
      const view = views.get(viewId);
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
            ? position.right * scale + window.width - (bounds.x + bounds.width)
            : undefined,
        bottom:
          position.bottom !== undefined
            ? position.bottom * scale +
              window.height -
              (bounds.y + bounds.height)
            : undefined,
      };
    }

    function openMenu(args: ContextMenuOpenArgs, caller?: ContextMenuCaller) {
      return attempt(() => {
        if (!caller?.appId)
          throw new Error("Caller app ID is required to open context menus");
        const viewId = resolveCallerViewId(caller.webContentsId);
        if (viewId === undefined)
          throw new Error(
            "Context menus can only be opened from a renderer view",
          );
        if (viewId === currentProvider()?.viewId)
          throw new Error("Display provider cannot open context menus");
        const requestId = `ctx-${Date.now()}-${++idCounter}`;
        if (activeRequest) {
          const previous = activeRequest;
          activeRequest = null;
          closed.emit({
            payload: { requestId: previous.requestId, reason: "replaced" },
            viewIds: audience(previous.opener.viewId),
          });
        }
        activeRequest = { requestId, opener: { appId: caller.appId, viewId } };
        const menu: ContextMenuOpenEvent = {
          requestId,
          title: args.title,
          position: toGlobalPosition(args.position, viewId),
          items: args.items,
        };
        opened.emit({ payload: { menu }, viewIds: audience(viewId) });
        log.info(`Context menu opened (${requestId})`);
        return { requestId };
      });
    }

    function resolveMenu(result: ContextMenuResult) {
      return attempt((): { success: boolean } => {
        if (!activeRequest || activeRequest.requestId !== result.requestId)
          return { success: false };
        const openerViewId = activeRequest.opener.viewId;
        activeRequest = null;
        closed.emit({ payload: result, viewIds: audience(openerViewId) });
        return { success: true };
      });
    }

    function closeMenu(
      requestId: string | undefined,
      caller?: ContextMenuCaller,
    ) {
      return attempt((): { success: boolean } => {
        if (!activeRequest) return { success: false };
        const targetId = requestId ?? activeRequest.requestId;
        if (targetId !== activeRequest.requestId) return { success: false };
        if (!caller?.appId)
          throw new Error("Caller app ID is required to close context menus");
        const callerViewId = resolveCallerViewId(caller.webContentsId);
        if (
          callerViewId === undefined ||
          callerViewId !== activeRequest.opener.viewId
        ) {
          log.warn(
            `Context menu close denied for ${caller.appId} (request ${targetId})`,
          );
          throw new Error("Only the original opener can close this menu");
        }
        const openerViewId = activeRequest.opener.viewId;
        activeRequest = null;
        closed.emit({
          payload: { requestId: targetId, reason: "close" },
          viewIds: audience(openerViewId),
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
  });
}

export type ContextMenu = Effect.Success<ReturnType<typeof createContextMenu>>;
