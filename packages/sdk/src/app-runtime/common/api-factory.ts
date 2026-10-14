export { createEdenAPI } from "./eden-api";
export type { EventSubscriptionCallback } from "./event-subscriptions";
export type { ShellTransport } from "./shell-transport";

import type {
  AppBusAPI,
  AppBusConnection,
  ServiceConnectCallback,
  ServiceInfo,
} from "@edenapp/types";
import type { AppBusState, IPCPort } from "./port-channel";
import { createPortConnection, waitForPort } from "./port-channel";
import type { ShellTransport } from "./shell-transport";

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

      if (registeredServices.has(serviceName)) {
        return {
          success: false,
          error: `Service "${serviceName}" is already registered`,
        };
      }

      // Reserve the callback before advertising the service: a port can arrive
      // before the registration response, or another exposure can be attempted.
      registeredServices.set(serviceName, onConnect);
      try {
        const { result } = await transport.exec("appbus/register", {
          serviceName,
          description: options?.description,
          allowedClients: options?.allowedClients,
        });
        if (
          !result.success &&
          registeredServices.get(serviceName) === onConnect
        )
          registeredServices.delete(serviceName);
        return result;
      } catch (error) {
        if (registeredServices.get(serviceName) === onConnect)
          registeredServices.delete(serviceName);
        throw error;
      }
    },

    unexposeService: async (
      serviceName: string,
    ): Promise<{ success: boolean }> => {
      registeredServices.delete(serviceName);
      const { result } = await transport.exec("appbus/unregister", {
        serviceName,
      });
      return result;
    },

    connect: async (
      targetAppId: string,
      serviceName: string,
    ): Promise<AppBusConnection | { error: string }> => {
      // Request connection through shell command
      const { result } = await transport.exec("appbus/connect", {
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
      return (await transport.exec("appbus/list", {})).result;
    },

    listServicesByApp: async (
      appId: string,
    ): Promise<{ services: ServiceInfo[] }> => {
      return (await transport.exec("appbus/list-by-app", { appId })).result;
    },
  };
}
