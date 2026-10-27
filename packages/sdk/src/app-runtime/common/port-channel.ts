import type {
  AppBusConnection,
  ServiceConnectCallback,
} from "@edenapp/types/ipc/appbus";
import { createEvent } from "../../core/events/event";
import { log } from "../../platform/logging/logger";
import type { IpcPort, IpcPortMessageEvent, PortMessage } from "./ipc-port";

export type { IpcPort } from "./ipc-port";
export { wrapDOMPort, wrapElectronPort } from "./ipc-port";

interface PendingRequest {
  resolve(value: unknown): void;
  reject(reason: unknown): void;
}

interface ConnectionArrival {
  promise: Promise<AppBusConnection>;
  resolve(connection: AppBusConnection): void;
  reject(reason: Error): void;
}

export interface AppBusState {
  registeredServices: Map<string, ServiceConnectCallback>;
  connections: Map<string, AppBusConnection>;
  pendingConnections: Map<string, ConnectionArrival>;
}

export interface AppBusPortData {
  connectionId: string;
  role: "service" | "client";
  serviceName: string;
  targetAppId?: string;
  sourceAppId?: string;
}

export function createAppBusState(): AppBusState {
  return {
    registeredServices: new Map(),
    connections: new Map(),
    pendingConnections: new Map(),
  };
}

/** The port can arrive before or after the shell command returns its ID. */
export function waitForConnection(
  connectionId: string,
  state: AppBusState,
  timeoutMs = 5000,
): Promise<AppBusConnection> {
  const connection = state.connections.get(connectionId);
  if (connection) return Promise.resolve(connection);
  const existing = state.pendingConnections.get(connectionId);
  if (existing) return existing.promise;

  const pending = Promise.withResolvers<AppBusConnection>();
  state.pendingConnections.set(connectionId, pending);
  const timeout = setTimeout(
    () =>
      pending.reject(
        new Error(
          `Connection ${connectionId} not received within ${timeoutMs}ms`,
        ),
      ),
    timeoutMs,
  );
  return pending.promise.finally(() => {
    clearTimeout(timeout);
    state.pendingConnections.delete(connectionId);
  });
}

/** One connection owns the port, its requests, and its listeners. */
export function createPortConnection(port: IpcPort): AppBusConnection {
  const pendingRequests = new Map<string, PendingRequest>();
  const messageListeners = new Map<string, Set<(args: unknown) => void>>();
  const requestHandlers = new Map<
    string,
    (args: unknown) => unknown | Promise<unknown>
  >();
  const closed = createEvent<void>();
  let isClosed = false;
  let nextMessageId = 0;

  function dispose() {
    if (isClosed) return;
    isClosed = true;
    port.off("message", onMessage);
    port.off("close", dispose);
    for (const pending of pendingRequests.values())
      pending.reject(new Error("Connection closed"));
    pendingRequests.clear();
    messageListeners.clear();
    requestHandlers.clear();
    closed.emit();
    closed.dispose();
  }

  async function respond(message: Extract<PortMessage, { type: "request" }>) {
    const { method, payload, messageId } = message;
    try {
      const handler = requestHandlers.get(method);
      if (!handler)
        throw new Error(`No handler registered for method '${method}'`);
      const response = await handler(payload);
      if (!isClosed)
        port.postMessage({ type: "response", messageId, payload: response });
    } catch (error) {
      if (!isClosed)
        port.postMessage({
          type: "response",
          messageId,
          error: error instanceof Error ? error.message : String(error),
        });
    }
  }

  function onMessage({ data }: IpcPortMessageEvent) {
    switch (data.type) {
      case "message":
        for (const callback of messageListeners.get(data.method) ?? []) {
          try {
            callback(data.payload);
          } catch (error) {
            log.error(`Error in on('${data.method}') listener:`, error);
          }
        }
        break;
      case "request":
        void respond(data).catch((error) =>
          log.error("Failed to send AppBus response:", error),
        );
        break;
      case "response": {
        const pending = pendingRequests.get(data.messageId);
        if (!pending) return;
        pendingRequests.delete(data.messageId);
        if (data.error) pending.reject(new Error(data.error));
        else pending.resolve(data.payload);
        break;
      }
    }
  }

  function on(method: string, callback: (args: unknown) => void) {
    if (typeof callback !== "function")
      throw new Error("Callback must be a function");
    if (!isClosed) {
      let listeners = messageListeners.get(method);
      if (!listeners) {
        listeners = new Set();
        messageListeners.set(method, listeners);
      }
      listeners.add(callback);
    }
  }

  function off(method: string, callback: (args: unknown) => void) {
    const listeners = messageListeners.get(method);
    listeners?.delete(callback);
    if (!listeners?.size) messageListeners.delete(method);
  }

  port.on("message", onMessage);
  port.on("close", dispose);
  port.start();

  return {
    send: (method: string, args?: unknown) => {
      if (isClosed) throw new Error("Connection closed");
      port.postMessage({ type: "message", method, payload: args });
    },
    on,
    once: (method: string, callback: (args: unknown) => void) => {
      if (typeof callback !== "function")
        throw new Error("Callback must be a function");
      const once = (args: unknown) => {
        off(method, once);
        callback(args);
      };
      on(method, once);
    },
    off,
    request: (
      method: string,
      args?: unknown,
      timeout = 30000,
    ): Promise<unknown> => {
      if (isClosed) return Promise.reject(new Error("Connection closed"));
      return new Promise((resolve, reject) => {
        const messageId = String(++nextMessageId);
        const timeoutId = setTimeout(() => {
          pendingRequests.delete(messageId);
          reject(new Error(`Request '${method}' timed out`));
        }, timeout);
        const pending = {
          resolve: (value: unknown) => {
            clearTimeout(timeoutId);
            resolve(value);
          },
          reject: (reason: unknown) => {
            clearTimeout(timeoutId);
            reject(reason);
          },
        };
        pendingRequests.set(messageId, pending);
        try {
          port.postMessage({
            type: "request",
            method,
            payload: args,
            messageId,
          });
        } catch (error) {
          pendingRequests.delete(messageId);
          pending.reject(error);
        }
      });
    },
    handle: (
      method: string,
      handler: (args: unknown) => unknown | Promise<unknown>,
    ) => {
      if (typeof handler !== "function")
        throw new Error("Handler must be a function");
      if (isClosed) throw new Error("Connection closed");
      if (requestHandlers.has(method))
        throw new Error(`Handler already registered for method '${method}'`);
      requestHandlers.set(method, handler);
    },
    removeHandler: (method: string) => {
      requestHandlers.delete(method);
    },
    isConnected: () => !isClosed,
    onClose: (callback: () => void) => {
      if (!isClosed) closed.on(callback);
    },
    close: () => {
      if (isClosed) return;
      try {
        port.close();
      } finally {
        dispose();
      }
    },
  };
}

export function handleAppBusPort(
  port: IpcPort,
  data: AppBusPortData,
  state: AppBusState,
): void {
  const { connectionId, role, serviceName, sourceAppId } = data;
  const onConnect = state.registeredServices.get(serviceName);
  if (role === "service" && !onConnect) {
    log.error(`No onConnect callback registered for service "${serviceName}"`);
    port.close();
    return;
  }

  const connection = createPortConnection(port);
  state.connections.get(connectionId)?.close();
  state.connections.set(connectionId, connection);
  connection.onClose(() => {
    if (state.connections.get(connectionId) === connection)
      state.connections.delete(connectionId);
  });
  if (role === "client") {
    state.pendingConnections.get(connectionId)?.resolve(connection);
  } else if (onConnect) {
    try {
      onConnect(connection, { appId: sourceAppId || "unknown" });
    } catch (error) {
      log.error(
        `Error in onConnect callback for service "${serviceName}":`,
        error,
      );
    }
  }
}

export function handlePortClosed(
  state: AppBusState,
  connectionId: string,
): void {
  state.connections.get(connectionId)?.close();
  state.pendingConnections
    .get(connectionId)
    ?.reject(new Error(`Connection ${connectionId} closed`));
}
