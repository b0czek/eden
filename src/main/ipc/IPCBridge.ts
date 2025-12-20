import { ipcMain, BrowserWindow, dialog } from "electron";
import { EventEmitter } from "events";
import { WorkerManager } from "../process-manager/WorkerManager";
import { ViewManager } from "../view-manager/ViewManager";
import { IPCMessage } from "@edenapp/types";
import { APP_EVENT_NAMES } from "@edenapp/types/runtime.generated";
import { randomUUID } from "crypto";
import { CommandRegistry } from "./CommandRegistry";

import { EventSubscriberManager } from "./EventSubscriberManager";

/**
 * IPCBridge
 *
 * Central communication hub for IPC messages between:
 * - Main process
 * - Worker threads (app backends)
 * - WebContentsViews (app frontends)
 */
export class IPCBridge extends EventEmitter {
  private workerManager: WorkerManager;
  private viewManager!: ViewManager;
  private commandRegistry: CommandRegistry;
  public eventSubscribers!: EventSubscriberManager;
  private mainWindow: BrowserWindow | null = null;
  private runningAppIds: Set<string> = new Set();
  private pendingResponses: Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (reason: any) => void;
      timeout: NodeJS.Timeout;
    }
  > = new Map();
  private pendingCommands: Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (reason: any) => void;
      timeout: NodeJS.Timeout;
    }
  > = new Map();
  private appChannelHandlers: Map<
    string,
    {
      channel: string;
      requestChannel: string;
      messageHandler: (...args: any[]) => void;
      requestHandler: (...args: any[]) => any;
    }
  > = new Map();

  constructor(workerManager: WorkerManager, commandRegistry: CommandRegistry) {
    super();
    this.workerManager = workerManager;
    this.commandRegistry = commandRegistry;

    this.setupIPCHandlers();
    this.setupWorkerMessageHandlers();
  }

  public setViewManager(viewManager: ViewManager): void {
    this.viewManager = viewManager;
    this.eventSubscribers = new EventSubscriberManager(viewManager);
  }

  /**
   * Set the main window for shell communication
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  /**
   * Get the main window instance
   */
  getMainWindow(): BrowserWindow | null {
    return this.mainWindow;
  }

  /**
   * Setup IPC handlers for renderer processes
   */
  private setupIPCHandlers(): void {
    // Handle messages from app frontends
    ipcMain.on("app-message", (event, message: IPCMessage) => {
      console.log(
        "IPC received app-message:",
        message.type,
        "from sender:",
        event.sender.id
      );
      this.handleAppMessage(message, event.sender.id);
    });

    // Handle message requests with responses
    ipcMain.handle(
      "app-message-request",
      async (event, message: IPCMessage) => {
        console.log(
          "IPC received app-message-request:",
          message.type,
          "from sender:",
          event.sender.id
        );
        return this.handleAppMessageRequest(message, event.sender.id);
      }
    );

    // Handle shell commands
    ipcMain.handle(
      "shell-command",
      async (event, command: string, args: any) => {
        // Get appId from sender for permission checking
        const appId = this.viewManager.getAppIdByWebContentsId(event.sender.id);
        return this.handleShellCommand(command, args, appId);
      }
    );

    // Event existence check
    ipcMain.handle("event-exists", async (_event, eventName: string) => {
      return APP_EVENT_NAMES.includes(eventName as any);
    });

    // Event subscription handlers
    ipcMain.handle("event-subscribe", async (event, eventName: string) => {
      // Validate event name
      if (!APP_EVENT_NAMES.includes(eventName as any)) {
        throw new Error(`Event '${eventName}' is not supported`);
      }

      const viewId = this.viewManager.getViewIdByWebContentsId(event.sender.id);
      if (viewId === undefined) {
        throw new Error("View not found");
      }

      return this.eventSubscribers.subscribe(viewId, eventName);
    });

    ipcMain.handle("event-unsubscribe", async (event, eventName: string) => {
      const viewId = this.viewManager.getViewIdByWebContentsId(event.sender.id);
      if (viewId === undefined) {
        throw new Error("View not found");
      }

      return this.eventSubscribers.unsubscribe(viewId, eventName);
    });

    // Generic file selection dialog
    ipcMain.handle("select-file", async (_event, options: any) => {
      if (!this.mainWindow) return null;

      const result = await dialog.showOpenDialog(this.mainWindow, {
        properties: ["openFile"],
        title: options?.title || "Select File",
        filters: options?.filters || [{ name: "All Files", extensions: ["*"] }],
      });

      return result.canceled ? null : result.filePaths[0];
    });

    // Get view data (launchArgs, channels, etc.) - called by preload to fetch all initialization data
    ipcMain.handle("get-view-data", async (event) => {
      const viewId = this.viewManager.getViewIdByWebContentsId(event.sender.id);
      if (viewId === undefined) {
        return { launchArgs: [] };
      }

      const viewInfo = this.viewManager.getViewInfo(viewId);
      if (!viewInfo) {
        return { launchArgs: [] };
      }

      const appId = viewInfo.appId;
      return {
        launchArgs: viewInfo.launchArgs || [],
        appId,
        viewId,
        channel: `app-${appId}`,
        requestChannel: `app-${appId}-request`,
      };
    });
  }

  /**
   * Register per-app IPC channels
   */
  registerAppChannels(appId: string): void {
    if (this.appChannelHandlers.has(appId)) return;

    const channel = `app-${appId}`;
    const requestChannel = `app-${appId}-request`;

    const messageHandler = (event: any, message: IPCMessage) => {
      console.log(
        `IPC received ${channel}:`,
        message.type,
        "from sender:",
        event.sender.id
      );
      this.handleAppMessage(message, event.sender.id);
    };

    const requestHandler = async (event: any, message: IPCMessage) => {
      console.log(
        `IPC received ${requestChannel}:`,
        message.type,
        "from sender:",
        event.sender.id
      );
      return this.handleAppMessageRequest(message, event.sender.id);
    };

    ipcMain.on(channel, messageHandler);
    ipcMain.handle(requestChannel, requestHandler);

    this.appChannelHandlers.set(appId, {
      channel,
      requestChannel,
      messageHandler,
      requestHandler,
    });

    console.log(`Registered IPC channels for app ${appId}`);
  }

  /**
   * Unregister per-app IPC channels
   */
  unregisterAppChannels(appId: string): void {
    const info = this.appChannelHandlers.get(appId);
    if (!info) return;

    try {
      ipcMain.removeListener(info.channel, info.messageHandler);
      ipcMain.removeHandler(info.requestChannel);
      this.appChannelHandlers.delete(appId);
      console.log(`Unregistered IPC channels for app ${appId}`);
    } catch (err) {
      console.warn(`Error unregistering channels for ${appId}:`, err);
    }
  }

  /**
   * Setup handlers for worker thread messages
   */
  private setupWorkerMessageHandlers(): void {
    this.workerManager.on(
      "worker-message",
      ({ appId, message }: { appId: string; message: IPCMessage }) => {
        console.log(
          `Worker message from ${appId}:`,
          message.type,
          "replyTo:",
          message.replyTo
        );
        this.routeMessage(message, "worker", appId);
      }
    );
  }

  /**
   * Route a message to its destination
   */
  private routeMessage(
    message: IPCMessage,
    sourceType: "worker" | "view",
    sourceId: string
  ): void {
    const { target, replyTo } = message;

    // IMPORTANT: Check if this is a reply to a pending request FIRST
    // This must happen before any other routing
    if (replyTo) {
      console.log(
        `Checking for pending response with replyTo: ${replyTo}, has it: ${this.pendingResponses.has(
          replyTo
        )}`
      );
      console.log(
        `Pending responses:`,
        Array.from(this.pendingResponses.keys())
      );

      if (this.pendingResponses.has(replyTo)) {
        console.log(`Found pending response for ${replyTo}, resolving...`);
        const pending = this.pendingResponses.get(replyTo)!;
        clearTimeout(pending.timeout);
        this.pendingResponses.delete(replyTo);
        pending.resolve(message.payload);
        return;
      }
    }

    // Route to target
    if (target === "backend" && sourceType === "view") {
      // Frontend sending to its own backend - use the source app ID
      console.log(`Routing view message to backend: ${sourceId}`);
      this.sendToApp(sourceId, message);
    } else if (target === "frontend" && sourceType === "worker") {
      // Backend sending to its own frontend - use the source app ID
      console.log(`Routing worker message to frontend: ${sourceId}`);
      this.sendToApp(sourceId, message);
    } else {
      // Send to specific app by ID
      this.sendToApp(target, message);
    }
  }

  /**
   * Handle message from app frontend
   */
  private handleAppMessage(message: IPCMessage, senderId: number): void {
    console.log("handleAppMessage - finding view for sender:", senderId);
    // Find which app this view belongs to
    const viewInfo = Array.from(this.viewManager.getActiveViews())
      .map((id) => this.viewManager.getViewInfo(id))
      .find((info) => info?.view.webContents.id === senderId);

    if (viewInfo) {
      console.log("Found view, routing to app:", viewInfo.appId);
      this.routeMessage(message, "view", viewInfo.appId);
    } else {
      console.log("View not found for sender:", senderId);
    }
  }

  /**
   * Handle message request from app frontend (expects response)
   */
  private async handleAppMessageRequest(
    message: IPCMessage,
    senderId: number
  ): Promise<any> {
    console.log("handleAppMessageRequest - finding view for sender:", senderId);
    const viewInfo = Array.from(this.viewManager.getActiveViews())
      .map((id) => this.viewManager.getViewInfo(id))
      .find((info) => info?.view.webContents.id === senderId);

    if (!viewInfo) {
      console.log("View not found for sender:", senderId);
      console.log("Active views:", this.viewManager.getActiveViews());
      throw new Error("View not found");
    }

    console.log("Found view, sending request to app:", viewInfo.appId);
    return this.sendMessageWithResponse(message, "view", viewInfo.appId);
  }

  /**
   * Send message and wait for response
   */
  private sendMessageWithResponse(
    message: IPCMessage,
    sourceType: "worker" | "view",
    sourceAppId: string,
    timeoutMs: number = 5000
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const messageId = message.messageId || randomUUID();
      message.messageId = messageId;

      console.log(
        `Storing pending response with messageId: ${messageId} for app: ${sourceAppId}`
      );

      const timeout = setTimeout(() => {
        console.log(`Message timeout for messageId: ${messageId}`);
        this.pendingResponses.delete(messageId);
        reject(new Error("Message timeout"));
      }, timeoutMs);

      this.pendingResponses.set(messageId, { resolve, reject, timeout });

      // Route the message
      this.routeMessage(message, sourceType, sourceAppId);
    });
  }

  /**
   * Send message to app (worker and/or view)
   */
  private sendToApp(appId: string, message: IPCMessage): void {
    console.log(
      `sendToApp called for ${appId}, message type: ${message.type}, messageId: ${message.messageId}`
    );

    // Send to worker backend
    if (this.workerManager.hasWorker(appId)) {
      console.log(`Sending to worker ${appId}`);
      this.workerManager.sendMessage(appId, message);
    } else {
      console.log(`No worker found for ${appId}`);
    }

    // Send to app's views
    const viewIds = this.viewManager.getViewsByAppId(appId);
    console.log(`Sending to ${viewIds.length} views for ${appId}`);
    for (const viewId of viewIds) {
      this.viewManager.sendToView(viewId, "shell-message", message);
    }
  }

  /**
   * Handle shell commands (app management, etc.)
   */
  private async handleShellCommand(command: string, args: any, appId?: string): Promise<any> {
    // Create a promise to wait for the command result
    const commandId = randomUUID();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.error(
          `[IPCBridge] Command '${command}' (ID: ${commandId}) timed out after 10s`
        );
        this.pendingCommands.delete(commandId);
        reject(new Error(`Command '${command}' timed out`));
      }, 10000);

      this.pendingCommands.set(commandId, { resolve, reject, timeout });

      // Execute via CommandRegistry with appId for permission checking
      this.commandRegistry
        .execute(command, args, appId)
        .then((result) => {
          clearTimeout(timeout);
          this.pendingCommands.delete(commandId);
          resolve(result);
        })
        .catch((error) => {
          console.error(
            `[IPCBridge] Command '${command}' (ID: ${commandId}) failed:`,
            error
          );
          clearTimeout(timeout);
          this.pendingCommands.delete(commandId);
          reject(error);
        });
    });
  }

  /**
   * Provide running-app updates from the AppManager
   */
  updateRunningApps(appIds: Iterable<string>): void {
    this.runningAppIds = new Set(appIds);
  }

  getRunningAppIds(): string[] {
    return Array.from(this.runningAppIds);
  }

  /**
   * Cleanup
   */
  destroy(): void {
    // Clear pending responses
    for (const pending of this.pendingResponses.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Bridge destroyed"));
    }
    this.pendingResponses.clear();

    // Clear pending commands
    for (const pending of this.pendingCommands.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Bridge destroyed"));
    }
    this.pendingCommands.clear();

    // Remove per-app IPC handlers
    for (const appId of this.appChannelHandlers.keys()) {
      this.unregisterAppChannels(appId);
    }

    // Remove global IPC handlers
    ipcMain.removeAllListeners("app-message");
    ipcMain.removeHandler("app-message-request");
    ipcMain.removeHandler("shell-command");
    ipcMain.removeHandler("event-exists");
    ipcMain.removeHandler("event-subscribe");
    ipcMain.removeHandler("event-unsubscribe");
    ipcMain.removeHandler("select-file");
    ipcMain.removeHandler("get-view-data");
  }
}
