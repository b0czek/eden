import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { type BrowserWindow, ipcMain } from "electron";
import { delay, inject, injectable, singleton } from "tsyringe";
import { RuntimeContextRegistry } from "../execution/RuntimeContextRegistry";
import { log } from "../logging";
import { BackendManager } from "../process-manager/BackendManager";
import { ViewManager } from "../view-manager/ViewManager";
import { CommandRegistry } from "./CommandRegistry";
import { EventHandler } from "./EventHandler";
import { EventSubscriberManager } from "./EventSubscriberManager";
import { PermissionRegistry } from "./PermissionRegistry";
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
      resolve: (value: unknown) => void;
      reject: (reason: unknown) => void;
      timeout: NodeJS.Timeout;
    }
  > = new Map();

  constructor(
    @inject(BackendManager) private backendManager: BackendManager,
    @inject(CommandRegistry) private commandRegistry: CommandRegistry,
    @inject(PermissionRegistry) permissionRegistry: PermissionRegistry,
    @inject(delay(() => ViewManager)) private viewManager: ViewManager,
    @inject(delay(() => RuntimeContextRegistry))
    private runtimeContexts: RuntimeContextRegistry,
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
      async (event, command: string, args: unknown) => {
        // Build caller context for commands that need it
        const appId = this.viewManager.getAppIdByWebContentsId(event.sender.id);
        const isFoundation =
          this.mainWindow?.webContents.id === event.sender.id;

        return this.handleShellCommand(command, args, {
          appId,
          webContentsId: event.sender.id,
          principal: appId
            ? this.runtimeContexts.resolvePrincipal(appId)
            : undefined,
          foundation: isFoundation,
        });
      },
    );
  }

  /**
   * Setup handlers for backend utility process messages
   */
  private setupBackendMessageHandlers(): void {
    this.backendManager.on(
      "backend-message",
      async ({ appId, message }: { appId: string; message: unknown }) => {
        if (!message || typeof message !== "object" || !("type" in message)) {
          log.warn(`Unknown backend message from ${appId}:`, message);
          return;
        }

        const backendMessage = message as {
          type: string;
          command?: string;
          commandId?: string;
          args?: unknown;
        };

        // Handle different message types from backend
        if (backendMessage.type === "shell-command") {
          if (!backendMessage.command || !backendMessage.commandId) {
            log.warn(`Malformed shell-command message from ${appId}:`, message);
            return;
          }

          // Backend requesting a shell command execution
          try {
            const result = await this.handleShellCommand(
              backendMessage.command,
              backendMessage.args,
              {
                appId,
                principal: this.runtimeContexts.resolvePrincipal(appId),
              },
            );
            // Send response back to backend
            this.sendBackendResponse(appId, backendMessage.commandId, result);
          } catch (error) {
            this.backendManager.sendMessage(appId, {
              type: "shell-command-response",
              commandId: backendMessage.commandId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        } else {
          log.warn(
            `Unknown backend message type from ${appId}:`,
            backendMessage.type,
          );
        }
      },
    );
  }

  /**
   * Helper to send response to backend
   */
  private sendBackendResponse(
    appId: string,
    commandId: string,
    result: unknown,
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
    args: unknown,
    callerContext: import("../execution").CommandCallerContext = {},
  ): Promise<unknown> {
    // Create a promise to wait for the command result
    const commandId = randomUUID();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        log.error(
          `Command '${command}' (ID: ${commandId}) timed out after 10s`,
        );
        this.pendingCommands.delete(commandId);
        reject(new Error(`Command '${command}' timed out`));
      }, 10000);

      this.pendingCommands.set(commandId, { resolve, reject, timeout });

      // Execute via CommandRegistry with trusted caller context
      this.commandRegistry
        .execute(command, args, callerContext)
        .then((result) => {
          clearTimeout(timeout);
          this.pendingCommands.delete(commandId);
          resolve(result);
        })
        .catch((error) => {
          const err = error as Error;
          const appInfo = callerContext.appId
            ? ` (app: ${callerContext.appId})`
            : "";
          log.error(
            `Command '${command}' (ID: ${commandId}) failed${appInfo}: ${err.message}`,
          );
          clearTimeout(timeout);
          this.pendingCommands.delete(commandId);
          const sanitized = new Error(err.message);
          sanitized.name = err.name;
          sanitized.stack = "";
          reject(sanitized);
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
