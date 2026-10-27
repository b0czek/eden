import type {
  CommandArgs,
  CommandName,
  CommandResult,
  EdenAPI,
  FilesystemLocation,
  OperationSubmission,
} from "@edenapp/types";
import { createEventSubscriptions } from "./event-subscriptions";
import { createOperationsAPI } from "./operations-api";
import type { ShellTransport } from "./shell-transport";

/** Build the public EdenAPI and its private incoming event dispatcher. */
export function createEdenAPI(
  transport: ShellTransport,
  options?: {
    getLaunchArgs?: () => string[];
    getLaunchFile?: () => FilesystemLocation | undefined;
  },
) {
  const subscriptions = createEventSubscriptions(transport);
  const api = {
    shellCommand: async <C extends CommandName>(
      command: C,
      args: CommandArgs<C>,
      submission?: OperationSubmission,
    ): Promise<CommandResult<C>> => {
      const response = await transport.exec(command, args, submission);
      if (response.mode === "operation")
        return operations.from(response.handle) as CommandResult<C>;
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
  return { api: edenAPI, dispatch: subscriptions.dispatch };
}
