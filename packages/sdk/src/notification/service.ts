import type {
  Notification,
  NotificationAction,
  NotificationType,
} from "@edenapp/types";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import type {
  RoutedNotification,
  TargetedNotification,
} from "../controllers/events";
import { scopedEvent } from "../events/scoped";
import { log } from "../logging";
import type { NotificationCaller, NotificationViews } from "./ports";

export type NotificationActionCallbacks = Record<
  string,
  (notification: Notification) => Effect.Effect<unknown, Error>
>;

interface ActiveNotification {
  notification: Notification;
  sourceViewId?: number;
  callbacks?: NotificationActionCallbacks;
}

const asError = (error: unknown) =>
  error instanceof Error ? error : new Error(String(error));

export function createNotifications({ views }: { views: NotificationViews }) {
  return Effect.gen(function* () {
    let idCounter = 0;
    let provider: { appId: string; viewId: number } | undefined;
    let disposed = false;
    const activeNotifications = new Map<string, ActiveNotification>();
    const added =
      yield* scopedEvent<
        TargetedNotification<{ notification: Notification }>
      >();
    const removed = yield* scopedEvent<TargetedNotification<{ id: string }>>();
    const actionClicked =
      yield* scopedEvent<
        RoutedNotification<{ notificationId: string; actionId: string }>
      >();
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        disposed = true;
        provider = undefined;
        activeNotifications.clear();
      }),
    );
    const scope = yield* Effect.scope;

    function assertOpen() {
      if (disposed) throw new Error("Notifications disposed");
    }

    function resolveViewId(webContentsId?: number) {
      const viewId = views.resolve(webContentsId);
      if (webContentsId !== undefined && viewId === undefined)
        log.warn(
          `Notification caller view not found for webContents ${webContentsId}`,
        );
      return viewId;
    }

    function getProvider() {
      return provider && views.isAlive(provider.viewId) ? provider : undefined;
    }

    function assertProvider(caller: NotificationCaller, action: string) {
      assertOpen();
      const current = getProvider();
      if (
        !current ||
        !caller.appId ||
        resolveViewId(caller.webContentsId) !== current.viewId
      )
        throw new Error(
          `Only the notification display provider can report ${action}`,
        );
    }

    function registerDisplayProvider(caller: NotificationCaller): {
      success: boolean;
    } {
      assertOpen();
      const viewId = resolveViewId(caller.webContentsId);
      if (viewId === undefined || !caller.appId)
        throw new Error("Notification display provider must be a valid view");
      provider = { appId: caller.appId, viewId };
      log.info(`Notification display provider registered: ${caller.appId}`);
      return { success: true };
    }

    function pushNotification(
      title: string,
      message: string,
      timeout = 5000,
      type: NotificationType = "info",
      actions?: NotificationAction[],
      callbacks?: NotificationActionCallbacks,
      caller?: NotificationCaller,
    ) {
      return Effect.try({
        try: () => {
          assertOpen();
          const id = `notif-${Date.now()}-${++idCounter}`;
          const sourceViewId = resolveViewId(caller?.webContentsId);
          const notification: Notification = {
            id,
            title,
            message,
            timeout: timeout > 0 ? timeout : undefined,
            createdAt: Date.now(),
            type,
            actions,
          };
          activeNotifications.set(id, {
            notification,
            sourceViewId,
            callbacks,
          });
          const current = getProvider();
          if (current)
            added.emit({
              payload: { notification },
              viewIds: [current.viewId],
            });
          log.info(`Notification pushed: "${title}" (${id}, type: ${type})`);
          return notification;
        },
        catch: asError,
      });
    }

    function handleActionClicked(
      notificationId: string,
      actionId: string,
      caller: NotificationCaller = {},
    ) {
      return Effect.gen(function* () {
        yield* Effect.try({
          try: () => assertProvider(caller, "actions"),
          catch: asError,
        });
        const active = activeNotifications.get(notificationId);
        const callback = active?.callbacks?.[actionId];
        if (callback && active) {
          const work = Effect.uninterruptibleMask((restore) =>
            Effect.gen(function* () {
              yield* restore(
                Effect.suspend(() => callback(active.notification)),
              );
              // Failed callbacks remain retryable; completed callbacks are one-shot.
              delete active.callbacks?.[actionId];
            }),
          );
          const fiber = yield* Effect.forkIn(work, scope);
          yield* Fiber.join(fiber);
        } else {
          actionClicked.emit({
            payload: { notificationId, actionId },
            viewIds:
              active?.sourceViewId === undefined
                ? undefined
                : [active.sourceViewId],
          });
        }
        return { success: true } as { success: boolean };
      });
    }

    function handleDismissed(
      notificationId: string,
      caller: NotificationCaller = {},
    ): { success: boolean } {
      assertProvider(caller, "dismissals");
      const active = activeNotifications.get(notificationId);
      if (!active) return { success: false };
      activeNotifications.delete(notificationId);
      if (active.sourceViewId !== undefined)
        removed.emit({
          payload: { id: notificationId },
          viewIds: [active.sourceViewId],
        });
      return { success: true };
    }

    return {
      registerDisplayProvider,
      pushNotification,
      handleActionClicked,
      handleDismissed,
      added,
      removed,
      actionClicked,
    };
  });
}

export type Notifications = Effect.Success<
  ReturnType<typeof createNotifications>
>;
