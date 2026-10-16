import { randomUUID } from "node:crypto";
import type { EventData, EventName, OperationSubmission } from "@edenapp/types";
import type { Controller } from "../controllers/controller";
import { ExecutionContext } from "../execution/context";
import { RuntimeContexts } from "../execution/runtime-contexts";
import { log } from "../logging";
import { Operations } from "../operations/service";
import { type PlatformWindow, type RendererIpcPort } from "../platform/ports";
import { Backends } from "../processes/backends";
import { Views } from "../views/service";
import { Commands } from "./commands";
import { createEventController } from "./controller-edenapi";
import { createEventRouting, type EventRouting } from "./event-routing";
import { Permissions } from "./permissions";

export function createIpcTransport({
  backends,
  commands,
  permissions,
  views,
  runtimeContexts,
  execution,
  rendererIpc,
  operations,
}: {
  backends: Backends;
  commands: Commands;
  permissions: Permissions;
  views: Views;
  runtimeContexts: RuntimeContexts;
  execution: ExecutionContext;
  rendererIpc: RendererIpcPort;
  operations: Operations;
}) {
  let eventSubscribers: EventRouting;
  let mainWindow: PlatformWindow | null = null;
  let controllerEvents = new Map<string, () => void>();
  let runningAppIds: Set<string> = new Set();
  let pendingCommands: Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (reason: unknown) => void;
      timeout: NodeJS.Timeout;
    }
  > = new Map();
  let stopBackendMessages: (() => void) | undefined;
  let backendMessageListener:
    | ((payload: { appId: string; message: unknown }) => void)
    | undefined;

  eventSubscribers = createEventRouting({
    views,
    execution,
    contexts: runtimeContexts,
    backends,
    permissions,
  });
  commands.registerController(
    createEventController(eventSubscribers, views, operations),
  );
  setupIPCHandlers();
  setupBackendMessageHandlers();
  function registerController(controller: Controller): void {
    for (const event of Object.keys(controller.events)) {
      const name = `${controller.namespace}/${event}`;
      if (controllerEvents.has(name))
        throw new Error(`Event already registered: ${name}`);
    }
    commands.registerController(controller);
    for (const [event, source] of Object.entries(controller.events)) {
      const name = `${controller.namespace}/${event}` as EventName;
      controllerEvents.set(
        name,
        source.on((payload, viewIds, scope) => {
          if (viewIds !== undefined) {
            for (const viewId of new Set(viewIds))
              eventSubscribers.notifyView(
                viewId,
                name,
                payload as EventData<typeof name>,
              );
          } else {
            eventSubscribers.notify(
              name,
              payload as EventData<typeof name>,
              scope,
            );
          }
        }),
      );
    }
  }
  function setMainWindow(window: PlatformWindow): void {
    mainWindow = window;
  }
  function getMainWindow(): PlatformWindow | null {
    return mainWindow;
  }
  function setupIPCHandlers(): void {
    // Handle shell commands
    rendererIpc.handle<[string, unknown, OperationSubmission?], unknown>(
      "shell-command",
      async (
        event,
        command: string,
        args: unknown,
        submission?: OperationSubmission,
      ) => {
        // Build caller context for commands that need it
        const appId = views.getAppIdByWebContentsId(event.sender.id);
        const isFoundation = mainWindow?.webContents.id === event.sender.id;

        if (!appId && !isFoundation) {
          throw new Error("Shell command caller is not a registered Eden view");
        }

        return handleShellCommand(
          command,
          args,
          {
            sessionId: appId ? callerSession(appId) : undefined,
            appId,
            webContentsId: event.sender.id,
            principal: appId
              ? runtimeContexts.resolvePrincipal(appId)
              : undefined,
            foundation: isFoundation,
          },
          submission,
        );
      },
    );
  }
  function setupBackendMessageHandlers(): void {
    backendMessageListener = async ({ appId, message }) => {
      if (!message || typeof message !== "object" || !("type" in message)) {
        log.warn(`Unknown backend message from ${appId}:`, message);
        return;
      }

      const backendMessage = message as {
        type: string;
        command?: string;
        commandId?: string;
        args?: unknown;
        submission?: OperationSubmission;
      };

      // Handle different message types from backend
      if (backendMessage.type === "shell-command") {
        if (!backendMessage.command || !backendMessage.commandId) {
          log.warn(`Malformed shell-command message from ${appId}:`, message);
          return;
        }

        // Backend requesting a shell command execution
        try {
          const result = await handleShellCommand(
            backendMessage.command,
            backendMessage.args,
            {
              appId,
              sessionId: callerSession(appId),
              principal: runtimeContexts.resolvePrincipal(appId),
            },
            backendMessage.submission,
          );
          // Send response back to backend
          sendBackendResponse(appId, backendMessage.commandId, result);
        } catch (error) {
          backends.sendMessage(appId, {
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
    };
    stopBackendMessages = backends.backendMessage.on(backendMessageListener);
  }
  function sendBackendResponse(
    appId: string,
    commandId: string,
    result: unknown,
  ): void {
    backends.sendMessage(appId, {
      type: "shell-command-response",
      commandId,
      result,
    });
  }
  function callerSession(appId: string): string | undefined {
    const owner = runtimeContexts.get(appId)?.owner;
    return owner?.kind === "session"
      ? owner.sessionId
      : owner?.kind === "system"
        ? "runtime"
        : undefined;
  }
  async function handleShellCommand(
    command: string,
    args: unknown,
    callerContext: import("../execution").CommandCallerContext = {},
    submission?: OperationSubmission,
  ): Promise<unknown> {
    // Create a promise to wait for the command result
    const commandId = randomUUID();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        log.error(
          `Command '${command}' (ID: ${commandId}) timed out after 10s`,
        );
        pendingCommands.delete(commandId);
        reject(new Error(`Command '${command}' timed out`));
      }, 10000);

      pendingCommands.set(commandId, { resolve, reject, timeout });

      // Execute via Commands with trusted caller context
      const mode = commands.getMode(command);
      commands
        .execute(command, args, callerContext, submission)
        .then((result) => {
          clearTimeout(timeout);
          pendingCommands.delete(commandId);
          resolve(
            mode === "operation"
              ? { mode: "operation", handle: result }
              : { mode: "result", result },
          );
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
          pendingCommands.delete(commandId);
          const sanitized = new Error(err.message);
          sanitized.name = err.name;
          sanitized.stack = "";
          reject(sanitized);
        });
    });
  }
  function updateRunningApps(appIds: Iterable<string>): void {
    runningAppIds = new Set(appIds);
  }
  function getRunningAppIds(): string[] {
    return Array.from(runningAppIds);
  }
  function destroy(): void {
    // Remove global IPC handlers
    rendererIpc.removeHandler("shell-command");
    if (backendMessageListener) {
      stopBackendMessages?.();
      backendMessageListener = undefined;
    }
    for (const pending of pendingCommands.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Eden runtime disposed"));
    }
    pendingCommands.clear();
    for (const stop of controllerEvents.values()) stop();
    controllerEvents.clear();
    eventSubscribers.dispose();

    mainWindow = null;
  }
  function dispose(): void {
    destroy();
  }
  return {
    eventSubscribers,
    registerController,
    setMainWindow,
    getMainWindow,
    updateRunningApps,
    getRunningAppIds,
    destroy,
    dispose,
  };
}
export type IpcTransport = ReturnType<typeof createIpcTransport>;
