import type { EdenAPI, FilesystemLocation } from "@edenapp/types";
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
    shellCommand: transport.exec,

    subscribe: subscriptions.subscribe.bind(subscriptions),
    unsubscribe: subscriptions.unsubscribe.bind(subscriptions),

    isEventSupported: (eventName: string) => {
      return transport.exec("event/exists", { eventName });
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
  return { ...api, operations: createOperationsAPI(api) };
}
