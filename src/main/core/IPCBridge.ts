import { ipcMain, BrowserWindow, dialog } from "electron";
import { EventEmitter } from "events";
import { WorkerManager } from "./WorkerManager";
import { ViewManager } from "../window-manager/ViewManager";
import { IPCMessage } from "../../types";
import { randomUUID } from "crypto";

/**
 * IPCBridge
 *
 * Central communication hub for IPC messages between:
 * - Main process
 * - Worker threads (app backends)
 * - WebContentsViews (app frontends)
 * - System shell
 */
export class IPCBridge extends EventEmitter {
  private workerManager: WorkerManager;
  private viewManager: ViewManager;
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

  constructor(workerManager: WorkerManager, viewManager: ViewManager) {
    super();
    this.workerManager = workerManager;
    this.viewManager = viewManager;

    this.setupIPCHandlers();
    this.setupWorkerMessageHandlers();
  }

  /**
   * Set the main window for shell communication
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
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
        return this.handleShellCommand(command, args);
      }
    );

    // System info requests
    ipcMain.handle("system-info", async () => {
      return this.getSystemInfo();
    });

    // File selection dialog for .edenite files
    ipcMain.handle("select-directory", async () => {
      if (!this.mainWindow) return null;

      const result = await dialog.showOpenDialog(this.mainWindow, {
        properties: ["openFile"],
        title: "Select .edenite App Package",
        filters: [
          { name: "Eden App Package", extensions: ["edenite"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });

      return result.canceled ? null : result.filePaths[0];
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
    sourceType: "worker" | "view" | "system",
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
    if (target === "system" || target === "shell") {
      // Send to shell/main window
      this.sendToShell(message);
    } else if (target === "backend" && sourceType === "view") {
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
    sourceType: "worker" | "view" | "system",
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
      this.viewManager.sendToView(viewId, "app-message", message);
    }
  }

  /**
   * Send message to shell
   */
  private sendToShell(message: IPCMessage): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      try {
        this.mainWindow.webContents.send("system-message", message);
      } catch (error) {
        // Window is being destroyed, ignore
        console.log("Could not send to shell, window destroyed");
      }
    }
  }

  /**
   * Handle shell commands (app management, etc.)
   */
  private async handleShellCommand(command: string, args: any): Promise<any> {
    // Create a promise to wait for the command result
    const commandId = randomUUID();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(commandId);
        reject(new Error("Command timeout"));
      }, 10000);

      this.pendingCommands.set(commandId, { resolve, reject, timeout });

      // Emit command event
      this.emit("shell-command", { command, args, commandId });
    });
  }

  /**
   * Respond to a shell command
   */
  respondToCommand(commandId: string, result: any, error?: any): void {
    const pending = this.pendingCommands.get(commandId);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pendingCommands.delete(commandId);

    if (error) {
      pending.reject(error);
    } else {
      pending.resolve(result);
    }
  }

  /**
   * Broadcast message to all apps
   */
  broadcastToApps(message: IPCMessage): void {
    if (this.runningAppIds.size === 0) {
      return;
    }

    for (const appId of this.runningAppIds) {
      this.sendToApp(appId, message);
    }
  }

  /**
   * Send system notification to all components
   */
  systemBroadcast(type: string, payload: any): void {
    const message: IPCMessage = {
      type,
      source: "system",
      target: "all",
      payload,
      messageId: randomUUID(),
      timestamp: Date.now(),
    };

    this.broadcastToApps(message);
    this.sendToShell(message);
  }

  /**
   * Get system information
   */
  private getSystemInfo(): any {
    return {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      electronVersion: process.versions.electron,
      runningApps: Array.from(this.runningAppIds),
      activeViews: this.viewManager.getActiveViews(),
    };
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
    ipcMain.removeHandler("system-info");
    ipcMain.removeHandler("select-directory");
    ipcMain.removeHandler("select-file");
  }
}
