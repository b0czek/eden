import type {
  AppBusAPI,
  AppBusConnection,
  CommandArgs,
  CommandName,
  CommandResult,
  EdenAPI,
  EventData,
  EventName,
  ServiceConnectCallback,
  ServiceInfo,
} from "@edenapp/types";
import type { AppBusState, IPCPort } from "./port-channel";
import { createPortConnection, waitForPort } from "./port-channel";

/**
 * Interface for sending shell commands to the main process
 */
export interface ShellTransport {
  exec<T extends CommandName>(
    command: T,
    args: CommandArgs<T>,
  ): Promise<CommandResult<T>>;
}

export type EventSubscriptionCallback = (payload: unknown) => void;

/**
 * Configuration for AppBus API
 */
export interface AppBusConfig {
  transport: ShellTransport;
}

/**
 * Create the EdenAPI object
 */
export function createEdenAPI(
  transport: ShellTransport,
  eventSubscriptions: Map<string, Set<EventSubscriptionCallback>>,
  options?: { getLaunchArgs?: () => string[] },
): EdenAPI {
  return {
    shellCommand: transport.exec,

    subscribe: async <T extends EventName>(
      eventName: T,
      callback: (data: EventData<T>) => void,
    ) => {
      if (typeof callback !== "function") {
        throw new Error("Callback must be a function");
      }

      // Register with backend/main
      await transport.exec("event/subscribe", { eventName });

      // Register callback locally
      if (!eventSubscriptions.has(eventName)) {
        eventSubscriptions.set(eventName, new Set());
      }
      eventSubscriptions
        .get(eventName)!
        .add(callback as EventSubscriptionCallback);
    },

    unsubscribe: async <T extends EventName>(
      eventName: T,
      callback: (data: EventData<T>) => void,
    ) => {
      const callbacks = eventSubscriptions.get(eventName);
      if (callbacks) {
        callbacks.delete(callback as EventSubscriptionCallback);

        // If no more callbacks, unregister from backend/main
        if (callbacks.size === 0) {
          eventSubscriptions.delete(eventName);
          await transport.exec("event/unsubscribe", { eventName });
        }
      }
    },

    isEventSupported: (eventName: string) => {
      return transport.exec("event/exists", { eventName });
    },

    getLaunchArgs: (): string[] => {
      if (options?.getLaunchArgs) {
        return options.getLaunchArgs();
      }
      return [];
    },
  };
}

/**
 * Create the AppBusAPI object
 */
export function createAppBusAPI(
  config: AppBusConfig,
  state: AppBusState,
): AppBusAPI {
  const { transport } = config;
  const {
    registeredServices,
    connectedPorts,
    pendingRequests,
    messageIdGenerator,
  } = state;

  return {
    exposeService: async (
      serviceName: string,
      onConnect: ServiceConnectCallback,
      options?: {
        description?: string;
        allowedClients?: string[];
      },
    ): Promise<{ success: boolean; error?: string }> => {
      if (typeof onConnect !== "function") {
        throw new Error("onConnect callback must be a function");
      }

      // Store the onConnect callback locally
      // When a client connects, handleAppBusPort will call this with the connection
      registeredServices.set(serviceName, onConnect);

      // Register with main process
      const result = await transport.exec("appbus/register", {
        serviceName,
        description: options?.description,
        allowedClients: options?.allowedClients,
      });

      if (!result.success) {
        registeredServices.delete(serviceName);
      }

      return result;
    },

    unexposeService: async (
      serviceName: string,
    ): Promise<{ success: boolean }> => {
      registeredServices.delete(serviceName);
      return transport.exec("appbus/unregister", {
        serviceName,
      });
    },

    connect: async (
      targetAppId: string,
      serviceName: string,
    ): Promise<AppBusConnection | { error: string }> => {
      // Request connection through shell command
      const result = await transport.exec("appbus/connect", {
        targetAppId,
        serviceName,
      });

      if (!result.success) {
        return { error: result.error || "Connection failed" };
      }

      const { connectionId } = result;
      if (!connectionId) {
        return { error: "Connection ID was not provided" };
      }

      // Wait for the port to be received via handleAppBusPort
      let port: IPCPort;
      try {
        port = await waitForPort(connectionId, state, 5000);
      } catch (err) {
        return {
          error:
            err instanceof Error ? err.message : "MessagePort not received",
        };
      }

      // Use shared utility to create connection object
      return createPortConnection(
        port,
        connectionId,
        connectedPorts,
        pendingRequests,
        messageIdGenerator,
      );
    },

    listServices: async (): Promise<{ services: ServiceInfo[] }> => {
      return transport.exec("appbus/list", {});
    },

    listServicesByApp: async (
      appId: string,
    ): Promise<{ services: ServiceInfo[] }> => {
      return transport.exec("appbus/list-by-app", { appId });
    },
  };
}
