import type {
  Notification,
  NotificationAction,
  NotificationType,
} from "@edenapp/types";
import { inject, injectable, singleton } from "tsyringe";
import { CommandRegistry, EdenEmitter, EdenNamespace, IPCBridge } from "../ipc";
import { log } from "../logging";
import { ViewManager } from "../view-manager";
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

interface DisplayProvider {
  appId: string;
  viewId: number;
}

@singleton()
@injectable()
@EdenNamespace("notification")
export class NotificationManager extends EdenEmitter<NotificationNamespaceEvents> {
  private notificationHandler: NotificationHandler;
  private idCounter: number = 0;
  private displayProvider: DisplayProvider | null = null;
  private activeNotifications = new Map<string, ActiveNotification>();

  constructor(
    @inject(IPCBridge) ipcBridge: IPCBridge,
    @inject(CommandRegistry) commandRegistry: CommandRegistry,
    @inject(ViewManager) private viewManager: ViewManager,
  ) {
    super(ipcBridge);

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

  private resolveCallerViewId(webContentsId?: number): number | undefined {
    if (webContentsId === undefined) return undefined;
    const viewId = this.viewManager.getViewIdByWebContentsId(webContentsId);
    if (viewId === undefined) {
      log.warn(
        `Notification caller view not found for webContents ${webContentsId}`,
      );
    }
    return viewId;
  }

  registerDisplayProvider(caller: NotificationCaller): { success: boolean } {
    const viewId = this.resolveCallerViewId(caller.webContentsId);
    if (viewId === undefined || !caller.appId) {
      throw new Error("Notification display provider must be a valid view");
    }

    this.displayProvider = { appId: caller.appId, viewId };
    log.info(`Notification display provider registered: ${caller.appId}`);
    return { success: true };
  }

  private notifyNotification<K extends keyof NotificationNamespaceEvents>(
    event: K,
    payload: NotificationNamespaceEvents[K],
  ): void {
    if (this.displayProvider) {
      this.notifySubscriber(this.displayProvider.viewId, event, payload);
    }
  }

  private isDisplayProvider(caller: NotificationCaller): boolean {
    if (!this.displayProvider || !caller.appId) return false;
    const callerViewId = this.resolveCallerViewId(caller.webContentsId);
    return callerViewId === this.displayProvider.viewId;
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
    const sourceViewId = this.resolveCallerViewId(caller?.webContentsId);
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
    if (!this.isDisplayProvider(caller ?? {})) {
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
    if (!this.isDisplayProvider(caller ?? {})) {
      throw new Error(
        "Only the notification display provider can report dismissals",
      );
    }

    return { success: this.activeNotifications.delete(notificationId) };
  }
}
