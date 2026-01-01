/**
 * Port Channel - Shared utilities for MessagePort communication
 *
 * This module provides reusable utilities for setting up MessagePort-based
 * communication channels between frontend, backend, and AppBus connections.
 *
 * Used by:
 * - app-preload.ts (frontend)
 * - backend-preload.ts (backend)
 */

// Re-export IPCPort types and wrappers
export { wrapDOMPort, wrapElectronPort } from "./ipc-port";
export type { IPCPort } from "./ipc-port";
import type { IPCPort } from "./ipc-port";

import type {
  AppBusConnection,
  ServiceConnectCallback,
} from "../../types/ipc/appbus";

/**
 * Pending request tracking
 */
export interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
}

/**
 * Options for setting up a client port
 */
export interface ClientPortOptions {
  port: IPCPort;
  connectionId: string;
  portStore: Map<string, IPCPort>;
  pendingRequests: Map<string, PendingRequest>;
  logPrefix?: string;
}

/**
 * Creates a message ID generator function that produces unique IDs using an optional prefix.
 *
 * @param prefix - Optional prefix to prepend to each generated message ID
 * @returns A unique message ID string that includes the provided `prefix`
 */
export function createMessageIdGenerator(prefix: string = "msg"): () => string {
  let counter = 0;
  return () => `${prefix}-${Date.now()}-${++counter}`;
}

/**
 * AppBus state for an app
 */
export interface AppBusState {
  registeredServices: Map<string, ServiceConnectCallback>;
  connectedPorts: Map<string, IPCPort>;
  pendingRequests: Map<string, PendingRequest>;
  messageIdGenerator: () => string;
}

/**
 * Create a new AppBusState with empty registries and a message ID generator.
 *
 * @param prefix - Optional prefix used by the message ID generator (defaults to "appbus")
 * @returns The initialized AppBusState containing empty `registeredServices`, `connectedPorts`, `pendingRequests`, and a `messageIdGenerator`
 */
export function createAppBusState(prefix: string = "appbus"): AppBusState {
  return {
    registeredServices: new Map(),
    connectedPorts: new Map(),
    pendingRequests: new Map(),
    messageIdGenerator: createMessageIdGenerator(prefix),
  };
}

/**
 * Registers a MessagePort as a client endpoint, wires response handling for outstanding requests, and starts the port.
 *
 * Stores the provided port in `portStore` under `connectionId`, listens for incoming messages of type `"response"` to resolve or reject matching entries in `pendingRequests`, and starts the port.
 *
 * @param options - Configuration containing the `port` to register, the `connectionId` key, the `portStore` map where the port will be stored, and the `pendingRequests` map whose entries are resolved or rejected when responses arrive
 */
export function setupClientPort(options: ClientPortOptions): void {
  const { port, connectionId, portStore, pendingRequests } = options;

  // Store the port for later use
  portStore.set(connectionId, port);

  // Set up response handler
  port.on("message", (event) => {
    const { type, messageId, payload, error } = event.data;

    if (type === "response" && messageId) {
      const pending = pendingRequests.get(messageId);
      if (pending) {
        pendingRequests.delete(messageId);
        if (error) {
          pending.reject(new Error(error));
        } else {
          pending.resolve(payload);
        }
      }
    }
  });

  port.start();
}

/**
 * Create a bidirectional AppBusConnection wrapper around an IPCPort.
 *
 * The returned connection supports fire-and-forget messaging, request/response flows with timeouts,
 * per-method event listeners, request handlers, and connection lifecycle management.
 *
 * @param port - The IPCPort to wrap and listen to for incoming messages
 * @param connectionId - Identifier used to register this port in `portStore`
 * @param portStore - Map that tracks active ports by connection ID; this function will add/remove the port
 * @param pendingRequests - Map used to track outstanding requests keyed by message ID; responses resolve/reject entries here
 * @param generateMessageId - Function that produces unique message IDs for outgoing requests
 * @returns An AppBusConnection exposing `send`, `on`, `once`, `off`, `request`, `handle`, `removeHandler`, `isConnected`, `onClose`, and `close` methods
 */
export function createPortConnection(
  port: IPCPort,
  connectionId: string,
  portStore: Map<string, IPCPort>,
  pendingRequests: Map<string, PendingRequest>,
  generateMessageId: () => string
): AppBusConnection {
  // Method-specific listeners for fire-and-forget messages (send → on)
  const messageListeners: Map<string, Set<(args: any) => void>> = new Map();

  // Method-specific handlers for request/response (request → handle)
  const requestHandlers: Map<string, (args: any) => any | Promise<any>> =
    new Map();

  // Store the port for later use (cleanup, connectivity checks)
  portStore.set(connectionId, port);

  // Set up incoming message handler
  port.on("message", (event) => {
    const { type, method, payload, messageId } = event.data;

    if (type === "message") {
      // Fire-and-forget message - dispatch to on() listeners
      const listeners = messageListeners.get(method);
      if (listeners) {
        listeners.forEach((callback) => {
          try {
            callback(payload);
          } catch (err) {
            console.error(
              `[PortConnection] Error in on('${method}') listener:`,
              err
            );
          }
        });
      }
    } else if (type === "request") {
      // Request expecting response - dispatch to handle() handler
      const handler = requestHandlers.get(method);
      if (handler) {
        try {
          const result = handler(payload);
          Promise.resolve(result)
            .then((response) => {
              port.postMessage({
                type: "response",
                messageId,
                payload: response,
              });
            })
            .catch((err) => {
              port.postMessage({
                type: "response",
                messageId,
                error: err instanceof Error ? err.message : String(err),
              });
            });
        } catch (err) {
          port.postMessage({
            type: "response",
            messageId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } else {
        port.postMessage({
          type: "response",
          messageId,
          error: `No handler registered for method '${method}'`,
        });
      }
    } else if (type === "response" && messageId) {
      // Response to our outgoing request
      const pending = pendingRequests.get(messageId);
      if (pending) {
        pendingRequests.delete(messageId);
        if (event.data.error) {
          pending.reject(new Error(event.data.error));
        } else {
          pending.resolve(payload);
        }
      }
    }
  });

  port.start();

  return {
    // Fire-and-forget messaging
    send: (method: string, args?: any) => {
      port.postMessage({ type: "message", method, payload: args });
    },

    on: (method: string, callback: (args: any) => void) => {
      if (typeof callback !== "function") {
        throw new Error("Callback must be a function");
      }
      if (!messageListeners.has(method)) {
        messageListeners.set(method, new Set());
      }
      messageListeners.get(method)!.add(callback);
    },

    once: (method: string, callback: (args: any) => void) => {
      if (typeof callback !== "function") {
        throw new Error("Callback must be a function");
      }
      const wrapper = (args: any) => {
        // Remove before calling to prevent issues if callback throws
        const listeners = messageListeners.get(method);
        if (listeners) {
          listeners.delete(wrapper);
          if (listeners.size === 0) {
            messageListeners.delete(method);
          }
        }
        callback(args);
      };
      if (!messageListeners.has(method)) {
        messageListeners.set(method, new Set());
      }
      messageListeners.get(method)!.add(wrapper);
    },

    off: (method: string, callback: (args: any) => void) => {
      const listeners = messageListeners.get(method);
      if (listeners) {
        listeners.delete(callback);
        if (listeners.size === 0) {
          messageListeners.delete(method);
        }
      }
    },

    // Request/response
    request: (
      method: string,
      args?: any,
      timeout: number = 30000
    ): Promise<any> => {
      return new Promise((resolve, reject) => {
        const messageId = generateMessageId();

        // Timeout after specified duration
        const timeoutId = setTimeout(() => {
          if (pendingRequests.has(messageId)) {
            pendingRequests.delete(messageId);
            reject(new Error(`Request '${method}' timed out`));
          }
        }, timeout);

        pendingRequests.set(messageId, {
          resolve: (value) => {
            clearTimeout(timeoutId);
            resolve(value);
          },
          reject: (reason) => {
            clearTimeout(timeoutId);
            reject(reason);
          },
        });

        port.postMessage({
          type: "request",
          method,
          payload: args,
          messageId,
        });
      });
    },

    handle: (method: string, handler: (args: any) => any | Promise<any>) => {
      if (typeof handler !== "function") {
        throw new Error("Handler must be a function");
      }
      if (requestHandlers.has(method)) {
        throw new Error(`Handler already registered for method '${method}'`);
      }
      requestHandlers.set(method, handler);
    },

    removeHandler: (method: string) => {
      requestHandlers.delete(method);
    },

    // Connection management
    isConnected: () => {
      return portStore.has(connectionId);
    },

    onClose: (callback: () => void) => {
      port.on("close", callback);
    },

    close: () => {
      portStore.delete(connectionId);
      messageListeners.clear();
      requestHandlers.clear();
      port.close();
    },
  };
}

/**
 * Bind a received IPC port into the AppBus as either a service-side or client-side connection.
 *
 * If `data.role` is `"service"`, looks up the registered service callback for `data.serviceName` and, if present,
 * creates an AppBus connection for the incoming client and invokes the callback with the connection and client info.
 * If `data.role` is `"client"`, prepares and registers the port for client-side request/response usage.
 *
 * @param port - The IPCPort to attach
 * @param data - Connection metadata:
 *   - `connectionId` — unique identifier for this connection
 *   - `role` — `"service"` when a remote client connects to a local service, `"client"` when connecting to a remote service
 *   - `serviceName` — name of the service being connected
 *   - `targetAppId` — optional target application id (for client role)
 *   - `sourceAppId` — optional source application id (for service role)
 * @param state - AppBus state containing registered services, connected ports, pending requests, and a message ID generator
 * @param logPrefix - Optional prefix used for log messages
 */
export function handleAppBusPort(
  port: IPCPort,
  data: {
    connectionId: string;
    role: "service" | "client";
    serviceName: string;
    targetAppId?: string;
    sourceAppId?: string;
  },
  state: AppBusState,
  logPrefix: string = "[AppBus]"
): void {
  const { connectionId, role, serviceName, targetAppId, sourceAppId } = data;

  if (role === "service") {
    // A client is connecting to our service
    console.log(
      `${logPrefix} Received connection from ${sourceAppId} for service ${serviceName}`
    );

    const onConnect = state.registeredServices.get(serviceName);
    if (!onConnect) {
      console.error(
        `${logPrefix} No onConnect callback registered for service "${serviceName}"`
      );
      return;
    }

    // Create a bidirectional AppBusConnection for the service to use
    const connection = createPortConnection(
      port,
      connectionId,
      state.connectedPorts,
      state.pendingRequests,
      state.messageIdGenerator
    );

    // Call the onConnect callback with the connection and client info
    try {
      onConnect(connection, { appId: sourceAppId || "unknown" });
    } catch (err) {
      console.error(
        `${logPrefix} Error in onConnect callback for service "${serviceName}":`,
        err
      );
    }
  } else if (role === "client") {
    // We're connecting to another app's service
    console.log(`${logPrefix} Connected to ${targetAppId}/${serviceName}`);

    setupClientPort({
      port,
      connectionId,
      portStore: state.connectedPorts,
      pendingRequests: state.pendingRequests,
    });
  }
}
/**
 * Remove and close the connected port identified by `connectionId` from the given AppBus state.
 *
 * @param state - The AppBus state containing connected ports
 * @param connectionId - The identifier of the closed connection to remove
 */
export function handlePortClosed(
  state: AppBusState,
  connectionId: string
): void {
  const port = state.connectedPorts.get(connectionId);
  if (port) {
    port.close();
    state.connectedPorts.delete(connectionId);
  }
}