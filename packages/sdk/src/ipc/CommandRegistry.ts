import type { OperationSubmission } from "@edenapp/types";
import * as Effect from "effect/Effect";
import type { Controller } from "../controllers/controller";
import { type EffectRuntime } from "../effects/runtime";
import {
  type CommandCallerContext,
  ExecutionContext,
} from "../execution/ExecutionContext";
import { OperationManager } from "../operations/OperationManager";
import type { OperationTask } from "../operations/OperationTask";
import type { SessionContext } from "../session";
import { assertFoundationCommandAllowed } from "./FoundationPolicy";
import { PermissionRegistry } from "./PermissionRegistry";
/**
 * CommandRegistry
 *
 * Central registry for namespaced command handlers.
 * Similar to FastAPI's APIRouter pattern - allows multiple managers
 * to register their own command handlers under namespaces.
 */

export type CommandHandler<TArgs = unknown, TResult = unknown> = (
  args: TArgs,
) => Promise<TResult> | TResult;

export interface RegisteredCommand {
  namespace: string;
  command: string;
  handler: CommandHandler;
  mode: "result" | "operation";
  permission?: string; // Full permission: "namespace/action"
}

export function createCommandRegistry({
  permissionRegistry,
  sessionContext,
  executionContext,
  operations,
  effects,
}: {
  permissionRegistry: PermissionRegistry;
  sessionContext: SessionContext;
  executionContext: ExecutionContext;
  operations: OperationManager;
  effects: EffectRuntime;
}) {
  let handlers = new Map<string, RegisteredCommand>();

  function registerController(controller: Controller): void {
    for (const name of Object.keys(controller.commands)) {
      const fullCommand = `${controller.namespace}/${name}`;
      if (handlers.has(fullCommand))
        throw new Error(`Command already registered: ${fullCommand}`);
    }
    for (const [name, command] of Object.entries(controller.commands)) {
      handlers.set(`${controller.namespace}/${name}`, {
        namespace: controller.namespace,
        command: name,
        mode: command.mode,
        permission: command.permission
          ? `${controller.namespace}/${command.permission}`
          : undefined,
        handler: (args) => command.execute(args, executionContext.get() ?? {}),
      });
    }
  }

  async function execute<TResult = unknown>(
    fullCommand: string,
    args: unknown,
    callerContext: CommandCallerContext = {},
    submission: OperationSubmission = {},
  ): Promise<TResult> {
    const metadata = handlers.get(fullCommand);

    if (!metadata) {
      throw new Error(`Unknown command: ${fullCommand}`);
    }

    const context = resolveCallerContext(callerContext);
    const appId = context.appId;

    if (context.foundation) {
      assertFoundationCommandAllowed(fullCommand);
    }

    return executionContext.run(context, async () => {
      // Check app permission if required
      if (metadata.permission && appId) {
        // First check if app has this as a base permission
        const hasBasePermission = permissionRegistry.hasPermission(
          appId,
          metadata.permission,
        );

        if (!hasBasePermission) {
          // Check if app declares a grant that would unlock this permission
          const requiredGrantKeys = permissionRegistry.getRequiredGrantKeys(
            appId,
            metadata.permission,
          );

          if (requiredGrantKeys.length === 0) {
            // App neither has base permission nor declares any grant for it
            throw new Error(
              `Permission denied: ${metadata.permission} required for ${fullCommand}`,
            );
          }

          // Check if user has any of the grants that would unlock this permission
          const hasGrant = requiredGrantKeys.some((grantKey) =>
            executionContext.hasGrant(grantKey),
          );

          if (!hasGrant) {
            throw new Error(
              `Grant denied: ${requiredGrantKeys.join(",")} required for ${fullCommand}`,
            );
          }
        }
      }

      if (metadata.mode === "operation") {
        const preparedArgs = structuredClone(sanitizeArgs(args));
        const fingerprintArgs = { ...preparedArgs };
        for (const key of Object.keys(fingerprintArgs))
          if (key.startsWith("_")) delete fingerprintArgs[key];
        return operations.submit(
          fullCommand,
          fingerprintArgs,
          context,
          () => metadata.handler(preparedArgs) as OperationTask<unknown>,
          submission,
        ) as TResult;
      }
      const result = await metadata.handler(sanitizeArgs(args));
      return (
        Effect.isEffect(result)
          ? await effects.run(result as Effect.Effect<unknown, unknown>)
          : await result
      ) as TResult;
    });
  }
  function resolveCallerContext(
    callerContext: CommandCallerContext,
  ): CommandCallerContext {
    if (callerContext.principal)
      return {
        ...callerContext,
        sessionId: callerContext.sessionId ?? sessionContext.getSessionId(),
      };
    if (callerContext.appId) {
      throw new Error(
        `Caller principal could not be resolved for app ${callerContext.appId}`,
      );
    }

    const profile = sessionContext.getCurrentUser();
    return profile
      ? {
          ...callerContext,
          sessionId: sessionContext.getSessionId(),
          principal: { kind: "user", profile },
        }
      : { ...callerContext, sessionId: sessionContext.getSessionId() };
  }
  function sanitizeArgs(args: unknown): Record<string, unknown> {
    const commandArgs =
      args && typeof args === "object" && !Array.isArray(args)
        ? (args as Record<string, unknown>)
        : {};

    const cleanArgs = { ...commandArgs };
    for (const key of Object.keys(cleanArgs))
      if (key.startsWith("_")) delete cleanArgs[key];
    return cleanArgs;
  }
  function getMode(fullCommand: string): RegisteredCommand["mode"] | undefined {
    return handlers.get(fullCommand)?.mode;
  }
  function has(fullCommand: string): boolean {
    return handlers.has(fullCommand);
  }
  function getCommands(): string[] {
    return Array.from(handlers.keys());
  }
  function getNamespaceCommands(namespace: string): string[] {
    return Array.from(handlers.values())
      .filter((meta) => meta.namespace === namespace)
      .map((meta) => `${meta.namespace}/${meta.command}`);
  }
  function clear(): void {
    handlers.clear();
  }
  function dispose(): void {
    clear();
  }
  return {
    registerController,
    execute,
    getMode,
    has,
    getCommands,
    getNamespaceCommands,
    clear,
    dispose,
  };
}
export type CommandRegistry = ReturnType<typeof createCommandRegistry>;
