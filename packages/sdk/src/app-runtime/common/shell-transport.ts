import type {
  CommandArgs,
  CommandName,
  CommandResult,
  OperationSubmission,
} from "@edenapp/types";

export interface ShellTransport {
  exec<C extends CommandName>(
    command: C,
    args: CommandArgs<C>,
    submission?: OperationSubmission,
  ): Promise<CommandResult<C>>;
}
