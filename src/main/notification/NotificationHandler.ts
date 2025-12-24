import { EdenHandler, EdenNamespace } from "../ipc";
import { NotificationManager } from "./NotificationManager";
import type { Notification } from "@edenapp/types";

@EdenNamespace("notification")
export class NotificationHandler {
  private notificationManager: NotificationManager;

  constructor(notificationManager: NotificationManager) {
    this.notificationManager = notificationManager;
  }

  /**
   * Add a new notification.
   */
  @EdenHandler("add")
  async handleAdd(args: {
    title: string;
    message: string;
    timeout?: number;
  }): Promise<Notification> {
    const { title, message, timeout } = args;
    return this.notificationManager.addNotification(title, message, timeout);
  }

  /**
   * Dismiss a notification by ID.
   */
  @EdenHandler("dismiss")
  async handleDismiss(args: { id: string }): Promise<{ success: boolean }> {
    const { id } = args;
    const success = this.notificationManager.dismissNotification(id);
    return { success };
  }

  /**
   * Get all active notifications.
   */
  @EdenHandler("list")
  async handleList(
    args: Record<string, never>
  ): Promise<{ notifications: Notification[] }> {
    const notifications = this.notificationManager.getNotifications();
    return { notifications };
  }

  /**
   * Clear all notifications.
   */
  @EdenHandler("clear")
  async handleClear(args: Record<string, never>): Promise<{ success: boolean }> {
    this.notificationManager.clearAll();
    return { success: true };
  }
}
