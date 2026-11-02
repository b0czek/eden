import type {
  CommandArgs,
  CommandMap,
  CommandName,
  CommandResponse,
  OperationHandle,
  OperationSubmission,
  StreamHandle,
} from "@edenapp/types";

/** Wire responses identify operations and streams explicitly, including custom commands. */
export type ShellCommandResponse<C extends CommandName> = C extends CommandName
  ? CommandMap[C]["mode"] extends "operation"
    ? { mode: "operation"; handle: OperationHandle<C> }
    : CommandMap[C]["mode"] extends "stream"
      ? { mode: "stream"; handle: StreamHandle<C> }
      : { mode: "result"; result: CommandResponse<C> }
  : never;

export interface ShellTransport {
  exec<C extends CommandName>(
    command: C,
    args: CommandArgs<C>,
    submission?: OperationSubmission,
  ): Promise<ShellCommandResponse<C>>;
}
