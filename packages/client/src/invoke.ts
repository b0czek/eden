import type {
  CommandArgs,
  CommandName,
  CommandResult,
  OperationSubmission,
} from "@edenapp/types";
import { getEdenAPI } from "./runtime.js";

export async function invoke<C extends CommandName>(
  command: C,
  args: CommandArgs<C>,
  submission?: OperationSubmission,
): Promise<CommandResult<C>> {
  return getEdenAPI().shellCommand(command, args, submission);
}
