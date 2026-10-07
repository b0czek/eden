export { createEdenAPI } from "./eden-api";
export type { ShellTransport } from "./shell-transport";
export type { EventSubscriptionCallback } from "./event-subscriptions";
import type { ShellTransport } from "./shell-transport";
import type {
  AppBusAPI,
  AppBusConnection,
  ServiceConnectCallback,
  ServiceInfo,
} from "@edenapp/types";
import type { AppBusState, IPCPort } from "./port-channel";
import { createPortConnection, waitForPort } from "./port-channel";

/**
 * Configuration for AppBus API
 */
export interface AppBusConfig {
  transport: ShellTransport;
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
