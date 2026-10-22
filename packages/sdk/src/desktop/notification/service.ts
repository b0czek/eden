import type {
  Notification,
  NotificationAction,
  NotificationType,
} from "@edenapp/types";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import type {
  RoutedNotification,
  TargetedNotification,
} from "../../core/controllers/events";
import type { Event } from "../../core/events/event";
import { scopedEvent } from "../../core/events/scoped";
import { log } from "../../platform/logging/logger";
import { NotificationCallerRejected, NotificationsClosed } from "./errors";
import { NotificationViews } from "./ports";
import type { NotificationActionCallbacks, NotificationCaller } from "./types";

export interface Notifications {
  /** Synchronously throws NotificationsClosed or NotificationCallerRejected. */
  registerDisplayProvider: (caller: NotificationCaller) => { success: boolean };
  pushNotification: (
    title: string,
    message: string,
    timeout?: number,
    type?: NotificationType,
    actions?: NotificationAction[],
    callbacks?: NotificationActionCallbacks,
    caller?: NotificationCaller,
  ) => Effect.Effect<Notification, NotificationsClosed>;
  /** Provider rejections and host callback failures; callback errors remain unchanged. */
  handleActionClicked: (
    notificationId: string,
    actionId: string,
    caller?: NotificationCaller,
  ) => Effect.Effect<{ success: boolean }, Error>;
  /** Synchronously throws NotificationsClosed or NotificationCallerRejected. */
  handleDismissed: (
    notificationId: string,
    caller?: NotificationCaller,
  ) => { success: boolean };
  added: Event<TargetedNotification<{ notification: Notification }>>;
  removed: Event<TargetedNotification<{ id: string }>>;
  actionClicked: Event<
    RoutedNotification<{ notificationId: string; actionId: string }>
  >;
}

export const Notifications = Context.Service<
  "eden/Notifications",
  Notifications
>("eden/Notifications");

interface ActiveNotification {
  notification: Notification;
  sourceViewId?: number;
  callbacks?: NotificationActionCallbacks;
}

export const NotificationsLive = Layer.effect(
  Notifications,
  Effect.gen(function* () {
    const views = yield* NotificationViews;
    const clock = yield* Clock.Clock;
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
      if (disposed)
        throw new NotificationsClosed({ message: "Notifications disposed" });
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

    function providerRejection(
      caller: NotificationCaller,
      action: "actions" | "dismissals",
    ) {
      if (disposed)
        return new NotificationsClosed({ message: "Notifications disposed" });
      const current = getProvider();
      if (
        !current ||
        !caller.appId ||
        resolveViewId(caller.webContentsId) !== current.viewId
      )
        return new NotificationCallerRejected({
          operation: action,
          ...caller,
          message: `Only the notification display provider can report ${action}`,
        });
    }

    function registerDisplayProvider(caller: NotificationCaller): {
      success: boolean;
    } {
      assertOpen();
      const viewId = resolveViewId(caller.webContentsId);
      if (viewId === undefined || !caller.appId)
        throw new NotificationCallerRejected({
          operation: "register-display",
          ...caller,
          message: "Notification display provider must be a valid view",
        });
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
      return Effect.suspend(() => {
        if (disposed)
          return Effect.fail(
            new NotificationsClosed({ message: "Notifications disposed" }),
          );
        return Effect.sync(() => {
          const createdAt = clock.currentTimeMillisUnsafe();
          const id = `notif-${createdAt}-${++idCounter}`;
          const sourceViewId = resolveViewId(caller?.webContentsId);
          const notification: Notification = {
            id,
            title,
            message,
            timeout: timeout > 0 ? timeout : undefined,
            createdAt,
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
        });
      });
    }

    function handleActionClicked(
      notificationId: string,
      actionId: string,
      caller: NotificationCaller = {},
    ): Effect.Effect<{ success: boolean }, Error> {
      return Effect.gen(function* () {
        const rejection = providerRejection(caller, "actions");
        if (rejection) return yield* Effect.fail(rejection);
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
        return { success: true };
      });
    }

    function handleDismissed(
      notificationId: string,
      caller: NotificationCaller = {},
    ): { success: boolean } {
      const rejection = providerRejection(caller, "dismissals");
      if (rejection) throw rejection;
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
    } satisfies Notifications;
  }),
);
