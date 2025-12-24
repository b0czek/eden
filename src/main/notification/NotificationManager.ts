import { Notification } from "@edenapp/types";
import { IPCBridge, CommandRegistry, EdenNamespace, EdenEmitter } from "../ipc";
import { NotificationHandler } from "./NotificationHandler";
import { injectable, inject } from "tsyringe";


/**
 * Events emitted by the NotificationManager
 */
interface NotificationNamespaceEvents {
  added: { notification: Notification };
  removed: { id: string };
}

@injectable()
@EdenNamespace("notification")
export class NotificationManager extends EdenEmitter<NotificationNamespaceEvents> {
  private notifications: Map<string, Notification> = new Map();
  private timeouts: Map<string, NodeJS.Timeout> = new Map();
  private notificationHandler: NotificationHandler;
  private idCounter: number = 0;

  constructor(
    @inject("IPCBridge") ipcBridge: IPCBridge,
    @inject("CommandRegistry") commandRegistry: CommandRegistry
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

  /**
   * Add a new timed notification
   * @param title - Notification title
   * @param message - Notification message body
   * @param timeout - Time in milliseconds before auto-dismiss (default: 5000ms)
   * @returns The created notification
   */
  addNotification(
    title: string,
    message: string,
    timeout: number = 5000
  ): Notification {
    const id = this.generateId();
    const notification: Notification = {
      id,
      title,
      message,
      timeout,
      createdAt: Date.now(),
    };

    this.notifications.set(id, notification);

    // Set up auto-dismiss timeout
    const timeoutHandle = setTimeout(() => {
      this.dismissNotification(id);
    }, timeout);
    this.timeouts.set(id, timeoutHandle);

    // Emit event for subscribers
    this.notify("added", { notification });

    console.log(`Notification added: "${title}" (${id}), timeout: ${timeout}ms`);

    return notification;
  }

  /**
   * Dismiss a notification by ID
   * @param id - Notification ID to dismiss
   * @returns true if notification was found and dismissed
   */
  dismissNotification(id: string): boolean {
    const notification = this.notifications.get(id);
    if (!notification) {
      return false;
    }

    // Clear the timeout if it exists
    const timeoutHandle = this.timeouts.get(id);
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      this.timeouts.delete(id);
    }

    // Remove the notification
    this.notifications.delete(id);

    // Emit event for subscribers
    this.notify("removed", { id });

    console.log(`Notification removed: ${id}`);

    return true;
  }

  /**
   * Get all active notifications
   * @returns Array of active notifications
   */
  getNotifications(): Notification[] {
    return Array.from(this.notifications.values());
  }

  /**
   * Clear all notifications
   */
  clearAll(): void {
    // Clear all timeouts
    for (const timeoutHandle of this.timeouts.values()) {
      clearTimeout(timeoutHandle);
    }
    this.timeouts.clear();

    // Get all IDs before clearing
    const ids = Array.from(this.notifications.keys());
    this.notifications.clear();

    // Emit remove events for all
    for (const id of ids) {
      this.notify("removed", { id });
    }

    console.log("All notifications cleared");
  }
}
