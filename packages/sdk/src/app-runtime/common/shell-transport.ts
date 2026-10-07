import type {
  CommandArgs,
  CommandMap,
  CommandName,
  CommandResponse,
  OperationHandle,
  OperationSubmission,
} from "@edenapp/types";

/** Wire responses identify operations explicitly, including custom commands. */
export type ShellCommandResponse<C extends CommandName> = C extends CommandName
  ? CommandMap[C]["mode"] extends "operation"
    ? { mode: "operation"; handle: OperationHandle<C> }
    : { mode: "immediate"; result: CommandResponse<C> }
  : never;

export interface ShellTransport {
  exec<C extends CommandName>(
    command: C,
    args: CommandArgs<C>,
    submission?: OperationSubmission,
  ): Promise<ShellCommandResponse<C>>;
}
