import type {
  CommandArgs,
  CommandResult,
  EventData,
  Notification,
  NotificationType,
} from "@edenapp/types";

export interface NotificationActionOptions {
  label: string;
  onClick: () => Promise<void> | void;
  dismissOnClick?: boolean;
}

export interface NotificationPushOptions {
  timeout?: number;
  type?: NotificationType;
}

export interface EdenNotificationAPI {
  push(
    title: string,
    message: string,
    options?: NotificationPushOptions,
  ): Promise<Notification>;
  push(
    title: string,
    message: string,
    actions: NotificationActionOptions[],
    options?: NotificationPushOptions,
  ): Promise<Notification>;
}

type NotificationCommand = "notification/push";
type NotificationEvent = "notification/action-clicked" | "notification/removed";

type EdenAPITransport = {
  shellCommand: <T extends NotificationCommand>(
    command: T,
    args: CommandArgs<T>,
  ) => Promise<CommandResult<T>>;
  subscribe: <T extends NotificationEvent>(
    event: T,
    handler: (payload: EventData<T>) => void,
  ) => Promise<void> | void;
};

interface PendingNotification {
  active: boolean;
  actionIds: Set<string>;
  notificationId?: string;
}

interface RoutedAction {
  dismissOnClick: boolean;
  notification: PendingNotification;
  onClick: () => Promise<void> | void;
}

const actionsById = new Map<string, RoutedAction>();
const notificationsById = new Map<string, PendingNotification>();
let actionIdCounter = 0;
let subscriptionPromise: Promise<void> | undefined;

const getEdenAPI = (): EdenAPITransport => {
  if (typeof window === "undefined") {
    throw new Error("notification can only be used in a browser environment.");
  }

  const api = (window as { edenAPI?: EdenAPITransport }).edenAPI;
  if (!api) {
    throw new Error("edenAPI is not available on window.");
  }

  return api;
};

const forgetNotification = (pending: PendingNotification) => {
  pending.active = false;
  for (const actionId of pending.actionIds) {
    actionsById.delete(actionId);
  }
  pending.actionIds.clear();
  if (pending.notificationId) {
    notificationsById.delete(pending.notificationId);
  }
};

const handleActionClicked = (
  payload: EventData<"notification/action-clicked">,
) => {
  const action = actionsById.get(payload.actionId);
  if (!action) return;

  if (!action.notification.notificationId) {
    action.notification.notificationId = payload.notificationId;
    notificationsById.set(payload.notificationId, action.notification);
  }

  if (action.dismissOnClick) {
    forgetNotification(action.notification);
  }

  try {
    const result = action.onClick();
    if (result && typeof result.then === "function") {
      void result.catch((error) => {
        console.error("Notification action handler failed:", error);
      });
    }
  } catch (error) {
    console.error("Notification action handler failed:", error);
  }
};

const handleNotificationRemoved = (
  payload: EventData<"notification/removed">,
) => {
  const pending = notificationsById.get(payload.id);
  if (pending) {
    forgetNotification(pending);
  }
};

const ensureSubscribed = async () => {
  if (!subscriptionPromise) {
    const edenAPI = getEdenAPI();
    subscriptionPromise = Promise.all([
      edenAPI.subscribe("notification/action-clicked", handleActionClicked),
      edenAPI.subscribe("notification/removed", handleNotificationRemoved),
    ])
      .then(() => undefined)
      .catch((error) => {
        subscriptionPromise = undefined;
        throw error;
      });
  }

  await subscriptionPromise;
};

const generateActionId = () =>
  `tablets-notification-${Date.now()}-${++actionIdCounter}`;

const push: EdenNotificationAPI["push"] = async (
  title: string,
  message: string,
  actionsOrOptions: NotificationActionOptions[] | NotificationPushOptions = {},
  maybeOptions: NotificationPushOptions = {},
) => {
  const actions = Array.isArray(actionsOrOptions) ? actionsOrOptions : [];
  const options = Array.isArray(actionsOrOptions)
    ? maybeOptions
    : actionsOrOptions;
  const pending: PendingNotification = { active: true, actionIds: new Set() };

  if (actions.length > 0) {
    await ensureSubscribed();
  }

  const transportActions = actions.map((action) => {
    const id = generateActionId();
    pending.actionIds.add(id);
    actionsById.set(id, {
      dismissOnClick: action.dismissOnClick !== false,
      notification: pending,
      onClick: action.onClick,
    });
    return {
      id,
      label: action.label,
      dismissOnClick: action.dismissOnClick,
    };
  });

  try {
    const result = await getEdenAPI().shellCommand("notification/push", {
      title,
      message,
      ...options,
      ...(transportActions.length > 0 ? { actions: transportActions } : {}),
    });
    pending.notificationId = result.id;
    if (pending.active && pending.actionIds.size > 0) {
      notificationsById.set(result.id, pending);
    }
    return result;
  } catch (error) {
    forgetNotification(pending);
    throw error;
  }
};

export const notification: EdenNotificationAPI = { push };
