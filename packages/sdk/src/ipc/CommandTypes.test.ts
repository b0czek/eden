import type {
  CommandCompletion,
  CommandResponse,
  CommandResult,
  ImmediateCommand,
  Operation,
  OperationCommand,
  OperationCompletion,
  OperationHandle,
  SystemInfo,
} from "@edenapp/types";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Assert<T extends true> = T;
type Contracts = [
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
  Assert<Equal<CommandResult<"system/info">, SystemInfo>>,
  Assert<Equal<CommandCompletion<"system/info">, never>>,
  Assert<Equal<ImmediateCommand<{}, string>["response"], string>>,
  Assert<
    Equal<
      OperationCommand<{}, number, "copy">["response"],
      OperationHandle<"copy">
    >
  >,
  Assert<Equal<OperationCommand<{}, number>["completion"], number>>,
];

it("provides serializable typed handles", () => {
  const handle: OperationHandle<"copy"> = { id: "id", command: "copy" };
  expect(JSON.parse(JSON.stringify(handle))).toEqual(handle);
  const coverage: Contracts extends true[] ? true : false = true;
  expect(coverage).toBe(true);
});
