import type {
  Notification,
  NotificationAction,
  NotificationType,
} from "@edenapp/types";
import { inject, injectable, Lifecycle, scoped } from "tsyringe";
import { CommandRegistry, EdenEmitter, EdenNamespace, IPCBridge } from "../ipc";
import { log } from "../logging";
import { DisplayProviderRegistry, ViewManager } from "../view-manager";
import { NotificationHandler } from "./NotificationHandler";

/**
 * Events emitted by the NotificationManager
 */
interface NotificationNamespaceEvents {
  added: { notification: Notification };
  removed: { id: string };
  "action-clicked": {
    notificationId: string;
    actionId: string;
  };
}

export type NotificationActionCallbacks = Record<
  string,
  (notification: Notification) => void | Promise<void>
>;

interface ActiveNotification {
  notification: Notification;
  sourceViewId?: number;
  callbacks?: NotificationActionCallbacks;
}

interface NotificationCaller {
  appId?: string;
  webContentsId?: number;
}

@scoped(Lifecycle.ContainerScoped)
@injectable()
@EdenNamespace("notification")
export class NotificationManager extends EdenEmitter<NotificationNamespaceEvents> {
  private notificationHandler: NotificationHandler;
  private idCounter: number = 0;
  private displayProviders: DisplayProviderRegistry;
  private activeNotifications = new Map<string, ActiveNotification>();

  constructor(
    @inject(IPCBridge) ipcBridge: IPCBridge,
    @inject(CommandRegistry) commandRegistry: CommandRegistry,
    @inject(ViewManager) private viewManager: ViewManager,
  ) {
    super(ipcBridge);

    this.displayProviders = new DisplayProviderRegistry(
      this.viewManager,
      "Notification",
    );
    // Create and register handler
    this.notificationHandler = new NotificationHandler(this);
    commandRegistry.registerManager(this.notificationHandler);
  }

  /**
   * Generate a unique notification ID
   */
  private generateId(): string {
    return `notif-${Date.now()}-${++this.idCounter}`;
  }

  private notifyNotification<K extends keyof NotificationNamespaceEvents>(
    event: K,
    payload: NotificationNamespaceEvents[K],
  ): void {
    const provider = this.displayProviders.getProvider();
    if (provider) {
      this.notifySubscriber(provider.viewId, event, payload);
    }
  }

  registerDisplayProvider(caller: NotificationCaller): { success: boolean } {
    return this.displayProviders.register(caller);
  }

  /**
   * Push a notification to subscribers.
   * @param title - Notification title
   * @param message - Notification message
   * @param timeout - Timeout in ms. Use 0 for persistent notification (default: 5000)
   * @param type - Notification type for styling
   */
  pushNotification(
    title: string,
    message: string,
    timeout: number = 5000,
    type: NotificationType = "info",
    actions?: NotificationAction[],
    callbacks?: NotificationActionCallbacks,
    caller?: NotificationCaller,
  ): Notification {
    const id = this.generateId();
    const sourceViewId = this.displayProviders.resolveCallerViewId(
      caller?.webContentsId,
    );
    const notification: Notification = {
      id,
      title,
      message,
      timeout: timeout > 0 ? timeout : undefined,
      createdAt: Date.now(),
      type,
      actions,
    };

    this.activeNotifications.set(id, { notification, sourceViewId, callbacks });
    this.notifyNotification("added", { notification });

    log.info(`Notification pushed: "${title}" (${id}, type: ${type})`);

    return notification;
  }

  async handleActionClicked(
    notificationId: string,
    actionId: string,
    caller?: NotificationCaller,
  ): Promise<{ success: boolean }> {
    if (!this.displayProviders.isProvider(caller ?? {})) {
      throw new Error(
        "Only the notification display provider can report actions",
      );
    }

    const activeNotification = this.activeNotifications.get(notificationId);
    const callback = activeNotification?.callbacks?.[actionId];
    if (callback && activeNotification) {
      await callback(activeNotification.notification);
      // Keep callbacks one-shot even when an action opts out of dismissing.
      delete activeNotification.callbacks?.[actionId];
      return { success: true };
    }

    if (activeNotification?.sourceViewId !== undefined) {
      this.notifySubscriber(activeNotification.sourceViewId, "action-clicked", {
        notificationId,
        actionId,
      });
      return { success: true };
    }

    this.notify("action-clicked", { notificationId, actionId });
    return { success: true };
  }

  handleDismissed(
    notificationId: string,
    caller?: NotificationCaller,
  ): { success: boolean } {
    if (!this.displayProviders.isProvider(caller ?? {})) {
      throw new Error(
        "Only the notification display provider can report dismissals",
      );
    }

    return { success: this.activeNotifications.delete(notificationId) };
  }

  override dispose(): void {
    this.displayProviders.dispose();
    this.activeNotifications.clear();
    super.dispose();
  }
}
