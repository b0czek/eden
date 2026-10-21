import type * as Effect from "effect/Effect";
import * as v from "valibot";
import type { CommandCallerContext } from "../execution/context";
import { type OperationTask, operationTask } from "../operations/task";
import type { ControllerEvent } from "./events";

type CommandMode = "result" | "operation";

/** The value sent across IPC, independent of the service's execution model. */
type ResultSuccess<Result> =
  Result extends Effect.Effect<infer Success, infer _Error, infer _Services>
    ? Success
    : Result;

type CommandSuccess<Result, Mode extends CommandMode> = Mode extends "operation"
  ? Result extends OperationTask<infer Completion, infer _Error>
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

/** Accept values and fully provided Effects, with native async work adapted explicitly. */
type ProvidedResult<Result> =
  Result extends Effect.Effect<infer _Success, infer _Error, infer Services>
    ? [Services] extends [never]
      ? Result
      : never
    : Result extends PromiseLike<unknown>
      ? never
      : Result;

interface CommandOptions<Args, Result, Mode extends CommandMode> {
  permission?: string;
  mode?: Mode;
  handle: (
    args: Args,
    caller: CommandCallerContext,
  ) => Result &
    (Mode extends "operation"
      ? Result extends OperationTask<infer _Completion, infer _Error>
        ? Result
        : never
      : ProvidedResult<Result>);
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

interface OperationOptions<Args, Result, E = unknown> {
  permission?: string;
  transition?: OperationTask<Result>["transition"];
  cancellable?: boolean;
  encodeFailure?: (error: NoInfer<E>) => NoInfer<Result>;
  prepare: (
    args: Args,
    caller: CommandCallerContext,
  ) => OperationTask<Result, E>["run"];
}

/** Validate and prepare synchronously; the operation runtime executes retained work. */
export function operation<Schema extends v.GenericSchema, Result, E = unknown>(
  options: OperationOptions<v.InferOutput<Schema>, Result, E> & {
    input: Schema;
  },
): Command<
  v.InferInput<Schema>,
  OperationTask<Result, E>,
  "operation",
  v.InferOutput<Schema>
>;
export function operation<Result, E = unknown>(
  options: OperationOptions<Record<string, never>, Result, E> & {
    input?: never;
  },
): Command<Record<string, never>, OperationTask<Result, E>, "operation">;
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
        encodeFailure: options.encodeFailure,
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
