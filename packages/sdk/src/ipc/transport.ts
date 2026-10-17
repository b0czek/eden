import type { EventData, EventName, OperationSubmission } from "@edenapp/types";
import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type * as Fiber from "effect/Fiber";
import * as FiberSet from "effect/FiberSet";
import type { Controller } from "../controllers/controller";
import { asError } from "../effects/io";
import type {
  CommandCallerContext,
  ExecutionContext,
} from "../execution/context";
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

export const createIpcTransport = Effect.fn(function* ({
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
  const forkCommand = yield* FiberSet.makeRuntime<never, unknown, unknown>();
  const forkDeadline = yield* FiberSet.makeRuntime<never, void, never>();
  const responseDeadline = Effect.sleep(Duration.seconds(10));
  let eventSubscribers: EventRouting;
  let mainWindow: PlatformWindow | null = null;
  let controllerEvents = new Map<string, () => void>();
  let runningAppIds: Set<string> = new Set();
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
  yield* Effect.addFinalizer(() => Effect.sync(destroy));
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

        return runShellCommand(
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
          const result = await runShellCommand(
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
  function runShellCommand(
    command: string,
    args: unknown,
    callerContext: CommandCallerContext = {},
    submission?: OperationSubmission,
  ): Promise<unknown> {
    const mode = commands.getMode(command);
    return new Promise((resolve, reject) => {
      // The response can time out before interrupted native I/O settles.
      // Both fibers remain scoped, so disposal still awaits command cleanup.
      const running = forkCommand(
        commands.execute(command, args, callerContext, submission),
      );
      let deadline: Fiber.Fiber<void> | undefined;
      let settled = false;

      function rejectResponse(error: Error) {
        log.error("Shell command failed:", error.message);
        const sanitized = new Error(error.message);
        sanitized.name = error.name;
        sanitized.stack = "";
        reject(sanitized);
      }

      running.addObserver((exit) => {
        if (settled) return;
        settled = true;
        deadline?.interruptUnsafe();
        if (Exit.isSuccess(exit)) {
          resolve(
            mode === "operation"
              ? { mode: "operation", handle: exit.value }
              : { mode: "result", result: exit.value },
          );
        } else {
          rejectResponse(
            Cause.hasInterruptsOnly(exit.cause)
              ? new Error("Eden runtime disposed")
              : asError(Cause.squash(exit.cause)),
          );
        }
      });
      // A completed command needs neither a timeout fiber nor a native timer.
      if (settled) return;
      deadline = forkDeadline(responseDeadline);
      deadline.addObserver((exit) => {
        if (settled) return;
        settled = true;
        running.interruptUnsafe();
        rejectResponse(
          Exit.isSuccess(exit)
            ? new Error(`Command '${command}' timed out`)
            : Cause.hasInterruptsOnly(exit.cause)
              ? new Error("Eden runtime disposed")
              : asError(Cause.squash(exit.cause)),
        );
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
    for (const stop of controllerEvents.values()) stop();
    controllerEvents.clear();
    eventSubscribers.dispose();

    mainWindow = null;
  }
  return {
    eventSubscribers,
    registerController,
    setMainWindow,
    getMainWindow,
    updateRunningApps,
    getRunningAppIds,
    destroy,
  };
});
export type IpcTransport = Effect.Success<
  ReturnType<typeof createIpcTransport>
>;
