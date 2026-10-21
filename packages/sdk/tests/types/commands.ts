import type {
  CommandCompletion,
  CommandResponse,
  CommandResult,
  Operation,
  OperationCommand,
  OperationCompletion,
  OperationHandle,
  ResultCommand,
  SystemInfo,
} from "@edenapp/types";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Assert<T extends true> = T;
export type CommandContracts = [
  Assert<Equal<CommandResponse<"fs/cp">, OperationHandle<"fs/cp">>>,
  Assert<Equal<CommandResult<"fs/cp">, Operation<"fs/cp">>>,
  Assert<Equal<ReturnType<Operation<"fs/cp">["result"]>, Promise<void>>>,
  Assert<
    Equal<
      ReturnType<Operation<"file/open">["result"]>,
      Promise<import("@edenapp/types").FileOpenResult>
    >
  >,
  Assert<Equal<CommandResult<"system/info">, SystemInfo>>,
  Assert<
    Equal<
      CommandResult<"fs/cp" | "system/info">,
      Operation<"fs/cp"> | SystemInfo
    >
  >,
  Assert<Equal<CommandCompletion<"fs/cp">, void>>,
  Assert<Equal<OperationCompletion<"fs/cp">, void>>,
  Assert<Equal<OperationCompletion<string>, unknown>>,
  Assert<Equal<CommandCompletion<"system/info">, never>>,
  Assert<
    Equal<ResultCommand<Record<string, never>, string>["response"], string>
  >,
  Assert<
    Equal<
      OperationCommand<Record<string, never>, number, "copy">["response"],
      OperationHandle<"copy">
    >
  >,
  Assert<
    Equal<OperationCommand<Record<string, never>, number>["completion"], number>
  >,
];
