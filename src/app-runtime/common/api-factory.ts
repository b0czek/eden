import type {
  EdenAPI,
  AppBusAPI,
  AppBusConnection,
  ServiceInfo,
  ServiceConnectCallback,
} from "@edenapp/types";
import type { PendingRequest, IPCPort, AppBusState } from "./port-channel";
import { createPortConnection } from "./port-channel";

/**
 * Interface for sending shell commands to the main process
 */
export interface ShellTransport {
  exec(command: string, args: any): Promise<any>;
}

/**
 * Configuration for AppBus API
 */
export interface AppBusConfig {
  transport: ShellTransport;
  isBackend?: boolean;
}

/**
 * Create an EdenAPI client that exposes shell command execution and managed event subscriptions backed by the provided transport.
 *
 * @param transport - Transport used to execute shell commands and coordinate event registration with the backend
 * @param eventSubscriptions - Mutable map used to track local event callbacks keyed by event name
 * @param options.getLaunchArgs - Optional function that returns process launch arguments; if omitted, an empty array is used
 * @returns An `EdenAPI` object with methods to execute shell commands, subscribe and unsubscribe from named events (synchronizing registrations with the backend), check whether an event is supported, and retrieve launch arguments
 */
export function createEdenAPI(
  transport: ShellTransport,
  eventSubscriptions: Map<string, Set<Function>>,
  options?: { getLaunchArgs?: () => string[] }
): EdenAPI {
  return {
    shellCommand: (command: string, args: any) => {
      return transport.exec(command, args);
    },

    subscribe: async (eventName: string, callback: Function) => {
      if (typeof callback !== "function") {
        throw new Error("Callback must be a function");
      }

      // Register with backend/main
      await transport.exec("event/subscribe", { eventName });

      // Register callback locally
      if (!eventSubscriptions.has(eventName)) {
        eventSubscriptions.set(eventName, new Set());
      }
      eventSubscriptions.get(eventName)!.add(callback);
    },

    unsubscribe: async (eventName: string, callback: Function) => {
      const callbacks = eventSubscriptions.get(eventName);
      if (callbacks) {
        callbacks.delete(callback);

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
 * Constructs an AppBusAPI for exposing services, accepting connections, and connecting to remote services.
 *
 * @param config - Configuration including the shell transport used to communicate with the main process and an optional `isBackend` flag.
 * @param state - Shared AppBus state containing registered service callbacks, connected MessagePorts, pending request map, and a message ID generator.
 * @returns An AppBusAPI object with methods to expose and unexpose services, initiate connections (returns an `AppBusConnection` on success or `{ error: string }` on failure), and list available services. */
export function createAppBusAPI(
  config: AppBusConfig,
  state: AppBusState
): AppBusAPI {
  const { transport, isBackend } = config;
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
      }
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
        isBackend,
      });

      if (!result.success) {
        registeredServices.delete(serviceName);
      }

      return result;
    },

    unexposeService: async (
      serviceName: string
    ): Promise<{ success: boolean }> => {
      registeredServices.delete(serviceName);
      return transport.exec("appbus/unregister", {
        serviceName,
      });
    },

    connect: async (
      targetAppId: string,
      serviceName: string
    ): Promise<AppBusConnection | { error: string }> => {
      // Request connection through shell command
      const result = await transport.exec("appbus/connect", {
        targetAppId,
        serviceName,
        isBackend,
      });

      if (!result.success) {
        return { error: result.error || "Connection failed" };
      }

      const { connectionId } = result;

      // Wait a bit for the port to be received
      // This relies on the port handler being set up separately and populating connectedPorts
      await new Promise((resolve) => setTimeout(resolve, 100)); // Increased to 100ms to match backend-preload, app-preload had 50ms

      const port = connectedPorts.get(connectionId);
      if (!port) {
        return { error: "MessagePort not received" };
      }

      // Use shared utility to create connection object
      return createPortConnection(
        port,
        connectionId,
        connectedPorts,
        pendingRequests,
        messageIdGenerator
      );
    },

    listServices: async (): Promise<{ services: ServiceInfo[] }> => {
      return transport.exec("appbus/list", {});
    },

    listServicesByApp: async (
      appId: string
    ): Promise<{ services: ServiceInfo[] }> => {
      return transport.exec("appbus/list-by-app", { appId });
    },
  };
}