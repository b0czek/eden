import type { NotificationAction, NotificationType } from "@edenapp/types";
import * as v from "valibot";
import { command, defineController } from "../controllers/controller";
import { routedEvent, targetedEvent } from "../controllers/events";
import type { Notifications } from "./service";

const notificationType: v.GenericSchema<NotificationType> = v.picklist([
  "info",
  "success",
  "warning",
  "danger",
]);
const action: v.GenericSchema<NotificationAction> = v.object({
  id: v.string(),
  label: v.string(),
  dismissOnClick: v.optional(v.boolean()),
});

export function createNotificationController(notifications: Notifications) {
  return defineController("notification", {
    commands: {
      /** Register the notification display provider. */
      "register-display": command({
        permission: "display",
        handle: (_args, caller) =>
          notifications.registerDisplayProvider(caller),
      }),
      /** Push a new notification to subscribers. */
      push: command({
        input: v.object({
          title: v.string(),
          message: v.string(),
          timeout: v.optional(v.number()),
          type: v.optional(notificationType),
          actions: v.optional(v.array(action)),
        }),
        handle: ({ title, message, timeout, type, actions }, caller) =>
          notifications.pushNotification(
            title,
            message,
            timeout,
            type,
            actions,
            undefined,
            caller,
          ),
      }),
      /** Report a notification action click from the toaster. */
      "action-clicked": command({
        permission: "display",
        input: v.object({ notificationId: v.string(), actionId: v.string() }),
        handle: ({ notificationId, actionId }, caller) =>
          notifications.handleActionClicked(notificationId, actionId, caller),
      }),
      /** Report a notification dismissal from the toaster. */
      dismissed: command({
        permission: "display",
        input: v.object({ notificationId: v.string() }),
        handle: ({ notificationId }, caller) =>
          notifications.handleDismissed(notificationId, caller),
      }),
    },
    events: {
      added: targetedEvent(notifications.added),
      removed: targetedEvent(notifications.removed),
      "action-clicked": routedEvent(notifications.actionClicked),
    },
  });
}
