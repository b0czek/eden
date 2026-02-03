import { Notification, NotificationType } from "@edenapp/types";
import { IPCBridge, CommandRegistry, EdenNamespace, EdenEmitter } from "../ipc";
import { NotificationHandler } from "./NotificationHandler";
import { injectable, inject, singleton } from "tsyringe";

import { log } from "../logging";
/**
 * Events emitted by the NotificationManager
 */
interface NotificationNamespaceEvents {
  added: { notification: Notification };
  removed: { id: string };
}

@singleton()
@injectable()
@EdenNamespace("notification")
export class NotificationManager extends EdenEmitter<NotificationNamespaceEvents> {
  private notificationHandler: NotificationHandler;
  private idCounter: number = 0;

  constructor(
    @inject(IPCBridge) ipcBridge: IPCBridge,
    @inject(CommandRegistry) commandRegistry: CommandRegistry
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
    type: NotificationType = "info"
  ): Notification {
    const id = this.generateId();
    const notification: Notification = {
      id,
      title,
      message,
      timeout: timeout > 0 ? timeout : undefined,
      createdAt: Date.now(),
      type,
    };

    this.notify("added", { notification });

    log.info(`Notification pushed: "${title}" (${id}, type: ${type})`);

    return notification;
  }
}
