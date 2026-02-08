import type { Notification, NotificationType } from "@edenapp/types";
import { EdenHandler, EdenNamespace } from "../ipc";
import type { NotificationManager } from "./NotificationManager";

@EdenNamespace("notification")
export class NotificationHandler {
  private notificationManager: NotificationManager;

  constructor(notificationManager: NotificationManager) {
    this.notificationManager = notificationManager;
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
  }): Promise<Notification> {
    const { title, message, timeout, type } = args;
    return this.notificationManager.pushNotification(
      title,
      message,
      timeout,
      type,
    );
  }
}
