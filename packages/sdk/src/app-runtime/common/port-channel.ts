import { log } from "../../logging";
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
} from "@edenapp/types/ipc/appbus";

/**
 * Pending request tracking
 */
export interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
}

/**
 * Pending port arrival tracking
 */
export interface PendingPortArrival {
  resolve: (port: IPCPort) => void;
  reject: (reason: Error) => void;
}

/**
 * Options for setting up a client port
 */
export interface ClientPortOptions {
  port: IPCPort;
  connectionId: string;
  portStore: Map<string, IPCPort>;
  pendingRequests: Map<string, PendingRequest>;
  pendingPortArrivals?: Map<string, PendingPortArrival>;
  logPrefix?: string;
}

/**
 * Message ID generator factory
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
  pendingPortArrivals: Map<string, PendingPortArrival>;
  messageIdGenerator: () => string;
}

/**
 * Create AppBus state for an app
 */
export function createAppBusState(prefix: string = "appbus"): AppBusState {
  return {
    registeredServices: new Map(),
    connectedPorts: new Map(),
    pendingRequests: new Map(),
    pendingPortArrivals: new Map(),
    messageIdGenerator: createMessageIdGenerator(prefix),
  };
}

/**
 * Wait for a port to arrive for a given connection ID
 *
 * @param connectionId The connection ID to wait for
 * @param state AppBus state containing connectedPorts and pendingPortArrivals
 * @param timeoutMs Timeout in milliseconds (default: 5000)
 * @returns Promise that resolves with the port or rejects on timeout
 */
export function waitForPort(
  connectionId: string,
  state: AppBusState,
  timeoutMs: number = 5000
): Promise<IPCPort> {
  // Check if port is already available
  const existing = state.connectedPorts.get(connectionId);
  if (existing) {
    return Promise.resolve(existing);
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      state.pendingPortArrivals.delete(connectionId);
      reject(
        new Error(
          `Port for connection ${connectionId} not received within ${timeoutMs}ms`
        )
      );
    }, timeoutMs);

    state.pendingPortArrivals.set(connectionId, {
      resolve: (port: IPCPort) => {
        clearTimeout(timeout);
        resolve(port);
      },
      reject: (reason: Error) => {
        clearTimeout(timeout);
        reject(reason);
      },
    });
  });
}

/**
 * Set up a MessagePort as a client (sends requests, receives responses)
 *
 * @param options Configuration for the client port
 */
export function setupClientPort(options: ClientPortOptions): void {
  const {
    port,
    connectionId,
    portStore,
    pendingRequests,
    pendingPortArrivals,
  } = options;

  // Store the port for later use
  portStore.set(connectionId, port);

  // Resolve any pending port arrivals waiting for this connection
  if (pendingPortArrivals) {
    const pending = pendingPortArrivals.get(connectionId);
    if (pending) {
      pendingPortArrivals.delete(connectionId);
      pending.resolve(port);
    }
  }

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
 * Create a connection object for a port (Electron IPC style)
 *
 * @param port The IPCPort to wrap
 * @param connectionId The connection ID
 * @param portStore The Map storing ports
 * @param pendingRequests The Map tracking pending requests for outgoing requests
 * @param generateMessageId Function to generate unique message IDs
 * @returns Connection object with send/on/off, request/handle/removeHandler, and close methods
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
            log.error(
              `Error in on('${method}') listener:`,
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
 * Handle an incoming AppBus port (can be service or client role)
 *
 * @param port The MessagePort received
 * @param data Connection metadata
 * @param state AppBus state (services, ports, pending requests)
 * @param logPrefix Prefix for log messages
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
  state: AppBusState
): void {
  const { connectionId, role, serviceName, targetAppId, sourceAppId } = data;

  if (role === "service") {
    // A client is connecting to our service
    log.info(
      `Received connection from ${sourceAppId} for service ${serviceName}`
    );

    const onConnect = state.registeredServices.get(serviceName);
    if (!onConnect) {
      log.error(
        `No onConnect callback registered for service "${serviceName}"`
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
      log.error(
        `Error in onConnect callback for service "${serviceName}":`,
        err
      );
    }
  } else if (role === "client") {
    // We're connecting to another app's service
    log.info(`Connected to ${targetAppId}/${serviceName}`);

    setupClientPort({
      port,
      connectionId,
      portStore: state.connectedPorts,
      pendingRequests: state.pendingRequests,
      pendingPortArrivals: state.pendingPortArrivals,
    });
  }
}
/**
 * Handle a port being closed from the other side
 * Triggered by a notification from the main process
 *
 * @param state AppBus state
 * @param connectionId The ID of the closed connection
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
