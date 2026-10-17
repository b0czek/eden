import type { OperationSubmission } from "@edenapp/types";
import * as Effect from "effect/Effect";
import type { Controller } from "../controllers/controller";
import { asError } from "../effects/io";
import {
  type CommandCallerContext,
  ExecutionContext,
} from "../execution/context";
import { Operations } from "../operations/service";
import type { OperationTask } from "../operations/task";
import type { SessionContext } from "../session";
import { assertFoundationCommandAllowed } from "./foundation-policy";
import { Permissions } from "./permissions";
/**
 * Commands
 *
 * Central registry for namespaced command handlers.
 * Allows domain controllers
 * to register their own command handlers under namespaces.
 */

export type CommandHandler<TArgs = unknown, TResult = unknown> = (
  args: TArgs,
) => TResult;

export interface RegisteredCommand {
  namespace: string;
  command: string;
  handler: CommandHandler;
  mode: "result" | "operation";
  permission?: string; // Full permission: "namespace/action"
}

export function createCommands({
  permissions,
  sessionContext,
  executionContext,
  operations,
}: {
  permissions: Permissions;
  sessionContext: SessionContext;
  executionContext: ExecutionContext;
  operations: Operations;
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

  function execute<TResult = unknown>(
    fullCommand: string,
    args: unknown,
    callerContext: CommandCallerContext = {},
    submission: OperationSubmission = {},
  ): Effect.Effect<TResult, unknown> {
    // Keep admission lazy without generator frames for each synchronous check.
    return Effect.suspend(() => {
      try {
        const metadata = handlers.get(fullCommand);
        if (!metadata) throw new Error(`Unknown command: ${fullCommand}`);
        const context = resolveCallerContext(callerContext);
        if (context.foundation) assertFoundationCommandAllowed(fullCommand);

        return executionContext.provide(
          Effect.suspend(() => {
            try {
              const result = invokeCommand(
                metadata,
                fullCommand,
                args,
                context,
                submission,
              );
              if (Effect.isEffect(result)) {
                // command() rejects unmet requirements before heterogeneous registry erasure.
                // @effect-diagnostics-next-line unsafeEffectTypeAssertion:off
                return result as Effect.Effect<TResult, unknown>;
              }
              return Effect.succeed(result as TResult);
            } catch (error) {
              return Effect.fail(asError(error));
            }
          }),
          context,
        );
      } catch (error) {
        return Effect.fail(asError(error));
      }
    });
  }
  function invokeCommand(
    metadata: RegisteredCommand,
    fullCommand: string,
    args: unknown,
    context: CommandCallerContext,
    submission: OperationSubmission,
  ): unknown {
    const appId = context.appId;
    // Check app permission if required
    if (metadata.permission && appId) {
      // First check if app has this as a base permission
      const hasBasePermission = permissions.hasPermission(
        appId,
        metadata.permission,
      );

      if (!hasBasePermission) {
        // Check if app declares a grant that would unlock this permission
        const requiredGrantKeys = permissions.getRequiredGrantKeys(
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
      );
    }
    return metadata.handler(sanitizeArgs(args));
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
export type Commands = ReturnType<typeof createCommands>;
