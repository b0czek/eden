import type {
  Notification,
  NotificationAction,
  NotificationType,
} from "@edenapp/types";
import { EdenHandler, EdenNamespace } from "../ipc";
import type { NotificationManager } from "./NotificationManager";

@EdenNamespace("notification")
export class NotificationHandler {
  private notificationManager: NotificationManager;

  constructor(notificationManager: NotificationManager) {
    this.notificationManager = notificationManager;
  }

  /**
   * Register the notification display provider.
   */
  @EdenHandler("register-display", { permission: "display" })
  async handleRegisterDisplay(args: {
    _callerAppId?: string;
    _callerWebContentsId?: number;
  }): Promise<{ success: boolean }> {
    return this.notificationManager.registerDisplayProvider({
      appId: args._callerAppId,
      webContentsId: args._callerWebContentsId,
    });
  }

  /**
   * Push a new notification to subscribers.
   */
  @EdenHandler("push")
  async handlePush(args: {
    title: string;
    message: string;
    timeout?: number;
    type?: NotificationType;
    actions?: NotificationAction[];
    _callerAppId?: string;
    _callerWebContentsId?: number;
  }): Promise<Notification> {
    const { title, message, timeout, type, actions } = args;
    return this.notificationManager.pushNotification(
      title,
      message,
      timeout,
      type,
      actions,
      undefined,
      {
        appId: args._callerAppId,
        webContentsId: args._callerWebContentsId,
      },
    );
  }

  /**
   * Report a notification action click from the toaster.
   */
  @EdenHandler("action-clicked", { permission: "display" })
  async handleActionClicked(args: {
    notificationId: string;
    actionId: string;
    _callerAppId?: string;
    _callerWebContentsId?: number;
  }): Promise<{ success: boolean }> {
    return this.notificationManager.handleActionClicked(
      args.notificationId,
      args.actionId,
      {
        appId: args._callerAppId,
        webContentsId: args._callerWebContentsId,
      },
    );
  }

  /**
   * Report a notification dismissal from the toaster.
   */
  @EdenHandler("dismissed", { permission: "display" })
  async handleDismissed(args: {
    notificationId: string;
    _callerAppId?: string;
    _callerWebContentsId?: number;
  }): Promise<{ success: boolean }> {
    return this.notificationManager.handleDismissed(args.notificationId, {
      appId: args._callerAppId,
      webContentsId: args._callerWebContentsId,
    });
  }
}
