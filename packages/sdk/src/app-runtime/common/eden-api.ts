import type {
  CommandArgs,
  CommandName,
  CommandResult,
  EdenAPI,
  FilesystemLocation,
  OperationSubmission,
  StreamHandle,
} from "@edenapp/types";
import { createEventSubscriptions } from "./event-subscriptions";
import { createOperationsAPI } from "./operations-api";
import type { ShellTransport } from "./shell-transport";
import { createStreamReaders } from "./stream-readers";

/** Build the public EdenAPI and its private incoming event dispatcher. */
export function createEdenAPI(
  transport: ShellTransport,
  options?: {
    getLaunchArgs?: () => string[];
    getLaunchFile?: () => FilesystemLocation | undefined;
  },
) {
  const subscriptions = createEventSubscriptions(transport);
  const streams = createStreamReaders(transport);
  const api = {
    shellCommand: async <C extends CommandName>(
      command: C,
      args: CommandArgs<C>,
      submission?: OperationSubmission,
    ): Promise<CommandResult<C>> => {
      const response = await transport.exec(command, args, submission);
      if (response.mode === "operation")
        return operations.from(response.handle) as CommandResult<C>;
      if (response.mode === "stream")
        return streams.open(
          response.handle as StreamHandle<C>,
        ) as CommandResult<C>;
      return response.result as CommandResult<C>;
    },

    subscribe: subscriptions.subscribe,
    unsubscribe: subscriptions.unsubscribe,

    isEventSupported: async (eventName: string) => {
      return (await transport.exec("event/exists", { eventName })).result;
    },

    getLaunchFile: () => {
      const location = options?.getLaunchFile?.();
      return location ? { ...location } : undefined;
    },

    getLaunchArgs: (): string[] => {
      if (options?.getLaunchArgs) {
        return options.getLaunchArgs();
      }
      return [];
    },
  };
  const operations = createOperationsAPI(api);
  const edenAPI: EdenAPI = { ...api, operations };
  return {
    api: edenAPI,
    dispatch: subscriptions.dispatch,
    dispatchStream: streams.dispatch,
  };
}
