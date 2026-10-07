import type {
  CommandArgs,
  CommandName,
  EdenAPI,
  FilesystemLocation,
  OperationSubmission,
  CommandResult,
} from "@edenapp/types";
import { createOperationsAPI } from "./operations-api";
import {
  EventSubscriptions,
  type EventSubscriptionCallback,
} from "./event-subscriptions";
import type { ShellTransport } from "./shell-transport";

/**
 * Create the EdenAPI object
 */
export function createEdenAPI(
  transport: ShellTransport,
  eventSubscriptions: Map<string, Set<EventSubscriptionCallback>>,
  options?: {
    getLaunchArgs?: () => string[];
    getLaunchFile?: () => FilesystemLocation | undefined;
  },
): EdenAPI {
  const subscriptions = new EventSubscriptions(transport, eventSubscriptions);
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

    subscribe: subscriptions.subscribe.bind(subscriptions),
    unsubscribe: subscriptions.unsubscribe.bind(subscriptions),

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
  return { ...api, operations };
}
