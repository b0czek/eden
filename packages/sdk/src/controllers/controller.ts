import type { Effect } from "effect";
import * as v from "valibot";
import type { CommandCallerContext } from "../execution/ExecutionContext";
import { type OperationTask, operationTask } from "../operations/OperationTask";
import type { ControllerEvent } from "./events";

type CommandMode = "result" | "operation";

/** The value sent across IPC, independent of the service's execution model. */
type ResultSuccess<Result> =
  Result extends Effect.Effect<infer Success, infer _Error, infer _Services>
    ? Success
    : Result extends PromiseLike<infer Success>
      ? ResultSuccess<Success>
      : Result;

type CommandSuccess<Result, Mode extends CommandMode> = Mode extends "operation"
  ? Result extends OperationTask<infer Completion>
    ? Completion
    : never
  : ResultSuccess<Result>;

export interface ControllerCommand {
  readonly permission?: string;
  readonly mode: CommandMode;
  execute(input: unknown, caller: CommandCallerContext): unknown;
}

export interface Command<
  Input,
  Result,
  Mode extends CommandMode = "result",
  Args = Input,
> extends ControllerCommand {
  readonly mode: Mode;
  readonly handle: (args: Args, caller: CommandCallerContext) => Result;
  /** Type-only metadata for contract generation; absent from runtime values. */
  readonly contract?: {
    readonly input: Input;
    readonly success: CommandSuccess<Result, Mode>;
  };
}

interface CommandOptions<Args, Result, Mode extends CommandMode> {
  permission?: string;
  mode?: Mode;
  handle: (args: Args, caller: CommandCallerContext) => Result;
}

export function command<
  Schema extends v.GenericSchema,
  Result,
  Mode extends CommandMode = "result",
>(
  options: CommandOptions<v.InferOutput<Schema>, Result, Mode> & {
    input: Schema;
  },
): Command<v.InferInput<Schema>, Result, Mode, v.InferOutput<Schema>>;
export function command<Result, Mode extends CommandMode = "result">(
  options: CommandOptions<Record<string, never>, Result, Mode> & {
    input?: never;
  },
): Command<Record<string, never>, Result, Mode>;
export function command(
  options: CommandOptions<never, unknown, CommandMode> & {
    input?: v.GenericSchema;
  },
): ControllerCommand {
  const schema = options.input ?? v.object({});
  return {
    ...options,
    mode: options.mode ?? "result",
    execute: (input, caller) =>
      options.handle(v.parse(schema, input) as never, caller),
  };
}

interface OperationOptions<Args, Result> {
  permission?: string;
  transition?: OperationTask<Result>["transition"];
  cancellable?: boolean;
  prepare: (
    args: Args,
    caller: CommandCallerContext,
  ) => OperationTask<Result>["run"];
}

/** Validate and prepare synchronously; the operation runtime executes retained work. */
export function operation<Schema extends v.GenericSchema, Result>(
  options: OperationOptions<v.InferOutput<Schema>, Result> & { input: Schema },
): Command<
  v.InferInput<Schema>,
  OperationTask<Result>,
  "operation",
  v.InferOutput<Schema>
>;
export function operation<Result>(
  options: OperationOptions<Record<string, never>, Result> & { input?: never },
): Command<Record<string, never>, OperationTask<Result>, "operation">;
export function operation(
  options: OperationOptions<never, unknown> & { input?: v.GenericSchema },
): ControllerCommand {
  return command({
    permission: options.permission,
    input: options.input ?? v.object({}),
    mode: "operation",
    handle: (args, caller) =>
      operationTask(options.prepare(args as never, caller), {
        transition: options.transition,
        cancellable: options.cancellable,
      }),
  });
}

export interface Controller {
  readonly namespace: string;
  readonly commands: Record<string, ControllerCommand>;
  readonly events: Record<string, ControllerEvent<unknown>>;
}

/** Keep the inferred command and event types available to the client generator. */
export function defineController<
  const Namespace extends string,
  Commands extends Record<string, ControllerCommand>,
  Events extends Record<string, ControllerEvent<unknown>> = Record<
    string,
    never
  >,
>(namespace: Namespace, definition: { commands: Commands; events?: Events }) {
  return {
    namespace,
    commands: definition.commands,
    events: definition.events ?? ({} as Events),
  };
}
