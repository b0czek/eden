import { ipcMain, BrowserWindow } from "electron";
import { EventEmitter } from "events";
import { BackendManager } from "../process-manager/BackendManager";
import { ViewManager } from "../view-manager/ViewManager";
import { randomUUID } from "crypto";
import { CommandRegistry } from "./CommandRegistry";
import { EventSubscriberManager } from "./EventSubscriberManager";
import { PermissionRegistry } from "./PermissionRegistry";
import { injectable, inject, singleton, delay } from "tsyringe";

import { EventHandler } from "./EventHandler";

/**
 * IPCBridge
 *
 * Central communication hub for IPC messages between:
 * - Main process
 * - Utility processes (app backends)
 * - WebContentsViews (app frontends)
 */
@singleton()
@injectable()
export class IPCBridge extends EventEmitter {
  public eventSubscribers: EventSubscriberManager;
  private eventHandler: EventHandler;
  private mainWindow: BrowserWindow | null = null;
  private runningAppIds: Set<string> = new Set();
  private pendingCommands: Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (reason: any) => void;
      timeout: NodeJS.Timeout;
    }
  > = new Map();

  constructor(
    @inject(BackendManager) private backendManager: BackendManager,
    @inject(CommandRegistry) private commandRegistry: CommandRegistry,
    @inject(PermissionRegistry) permissionRegistry: PermissionRegistry,
    @inject(delay(() => ViewManager)) private viewManager: ViewManager
  ) {
    super();

    // Initialize event subscriber manager
    this.eventSubscribers = new EventSubscriberManager(viewManager);
    this.eventSubscribers.setBackendManager(this.backendManager);
    this.eventSubscribers.setPermissionRegistry(permissionRegistry);

    // Initialize and register EventHandler
    this.eventHandler = new EventHandler(this.eventSubscribers, viewManager);
    this.commandRegistry.registerManager(this.eventHandler);

    this.setupIPCHandlers();
    this.setupBackendMessageHandlers();
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
    // Handle shell commands
    ipcMain.handle(
      "shell-command",
      async (event, command: string, args: any) => {
        // Build caller context for commands that need it
        const appId = this.viewManager.getAppIdByWebContentsId(event.sender.id);
        const argsWithContext = {
          ...args,
          _callerAppId: appId,
          _callerWebContentsId: event.sender.id,
        };
        return this.handleShellCommand(command, argsWithContext, appId);
      }
    );
  }

  /**
   * Setup handlers for backend utility process messages
   */
  private setupBackendMessageHandlers(): void {
    this.backendManager.on(
      "backend-message",
      async ({ appId, message }: { appId: string; message: any }) => {
        // Handle different message types from backend
        if (message.type === "shell-command") {
          // Backend requesting a shell command execution
          try {
            // Inject caller context for backend commands
            const argsWithContext = {
              ...message.args,
              _callerAppId: appId,
            };

            const result = await this.handleShellCommand(
              message.command,
              argsWithContext,
              appId
            );
            // Send response back to backend
            this.sendBackendResponse(appId, message.commandId, result);
          } catch (error) {
            this.backendManager.sendMessage(appId, {
              type: "shell-command-response",
              commandId: message.commandId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        } else {
          console.warn(
            `Unknown backend message type from ${appId}:`,
            message.type
          );
        }
      }
    );
  }

  /**
   * Helper to send response to backend
   */
  private sendBackendResponse(
    appId: string,
    commandId: string,
    result: any
  ): void {
    this.backendManager.sendMessage(appId, {
      type: "shell-command-response",
      commandId,
      result,
    });
  }

  /**
   * Handle shell commands (app management, etc.)
   */
  private async handleShellCommand(
    command: string,
    args: any,
    appId?: string
  ): Promise<any> {
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
    // Remove global IPC handlers
    ipcMain.removeHandler("shell-command");
  }
}
