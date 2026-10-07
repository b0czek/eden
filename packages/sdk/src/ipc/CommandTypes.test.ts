import type {
  CommandChunk,
  CommandCompletion,
  CommandResult,
  ImmediateCommand,
  OperationCommand,
  OperationHandle,
  StreamCommand,
  StreamHandle,
  SystemInfo,
} from "@edenapp/types";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Assert<T extends true> = T;
type Contracts = [
  Assert<Equal<CommandResult<"system/info">, SystemInfo>>,
  Assert<Equal<CommandCompletion<"system/info">, never>>,
  Assert<Equal<CommandChunk<"system/info">, never>>,
  Assert<Equal<ImmediateCommand<{}, string>["response"], string>>,
  Assert<
    Equal<
      OperationCommand<{}, number, "copy">["response"],
      OperationHandle<"copy">
    >
  >,
  Assert<Equal<OperationCommand<{}, number>["completion"], number>>,
  Assert<
    Equal<
      StreamCommand<{}, number, boolean, "scan">["response"],
      StreamHandle<"scan">
    >
  >,
  Assert<Equal<StreamCommand<{}, number, boolean>["chunk"], number>>,
  Assert<Equal<StreamCommand<{}, number, boolean>["completion"], boolean>>,
];

it("provides serializable typed handles", () => {
  const handle: OperationHandle<"copy"> = { id: "id", command: "copy" };
  expect(JSON.parse(JSON.stringify(handle))).toEqual(handle);
  const coverage: Contracts extends true[] ? true : false = true;
  expect(coverage).toBe(true);
});
