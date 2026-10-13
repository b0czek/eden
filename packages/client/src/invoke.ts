import type {
  CommandArgs,
  CommandName,
  CommandResult,
  EdenAPI,
  OperationSubmission,
} from "@edenapp/types";

/** Resolve at call time so importing the client does not require an Eden runtime. */
export async function invoke<C extends CommandName>(
  command: C,
  args: CommandArgs<C>,
  submission?: OperationSubmission,
): Promise<CommandResult<C>> {
  const runtime = globalThis as typeof globalThis & {
    window?: { edenAPI?: EdenAPI };
    worker?: { edenAPI?: EdenAPI };
  };
  const api = runtime.window?.edenAPI ?? runtime.worker?.edenAPI;
  if (!api) {
    throw new Error(
      "@edenapp/client requires an Eden frontend or backend runtime",
    );
  }
  return api.shellCommand(command, args, submission);
}
