import { contextBridge, ipcRenderer } from "electron";

// Per-app channel names (received from main process)
let appId: string | null = null;
let appChannel: string | null = null;
let appRequestChannel: string | null = null;
const messageListeners: Array<(message: any) => void> = [];

// Event subscription system
const eventSubscriptions: Map<string, Set<Function>> = new Map();

// Wait for initialization trigger from main process
// Fetch all data via get-view-data invoke
ipcRenderer.once("app-init-api", async () => {
  try {
    const data = await ipcRenderer.invoke("get-view-data");
    appId = data.appId;
    appChannel = data.channel;
    appRequestChannel = data.requestChannel;

    console.log(`App API initialized for ${appId} on channel ${appChannel}`);
  } catch (err) {
    console.error("Failed to initialize app API:", err);
  }
});

// Set up unified message listener for shell-message channel
ipcRenderer.on("shell-message", (_event: any, message: any) => {
  const { type, payload } = message;
  const callbacks = eventSubscriptions.get(type);

  if (callbacks) {
    callbacks.forEach((callback) => {
      try {
        callback(payload);
      } catch (err) {
        console.error(`Error in event listener for ${type}:`, err);
      }
    });
  }
});

// Expose safe API to the app
contextBridge.exposeInMainWorld("appAPI", {
  /**
   * Send a message to this app's backend
   * @param {object} message - Message to send to backend
   */
  sendMessage: (message: any) => {
    if (!appChannel) {
      throw new Error("App API not yet initialized");
    }
    ipcRenderer.send(appChannel, message);
  },

  /**
   * Send a request to this app's backend and wait for response
   * @param {object} message - Message to send to backend
   * @returns {Promise} Response from backend
   */
  sendRequest: async (message: any) => {
    if (!appRequestChannel) {
      throw new Error("App API not yet initialized");
    }
    return ipcRenderer.invoke(appRequestChannel, message);
  },

  /**
   * Listen for messages from this app's backend
   * @param {function} callback - Called when backend sends a message
   */
  onMessage: (callback: (message: any) => void) => {
    if (typeof callback !== "function") {
      throw new Error("Callback must be a function");
    }
    messageListeners.push(callback);
  },

  /**
   * Get this app's ID
   * @returns {string|null} The app ID or null if not yet initialized
   */
  getAppId: () => {
    return appId;
  },
});

// Expose edenAPI for shell commands and event subscriptions
contextBridge.exposeInMainWorld("edenAPI", {
  /**
   * Execute shell commands (e.g., stop-app, set-view-visibility)
   * @param {string} command - The command to execute
   * @param {object} args - Command arguments
   * @returns {Promise} Command result
   */
  shellCommand: (command: string, args: any) => {
    console.log("Executing shell command:", command, args);
    return ipcRenderer.invoke("shell-command", command, args);
  },

  /**
   * Subscribe to an event from the shell/system
   * @param {string} eventName - Name of the event to subscribe to
   * @param {function} callback - Called when event is emitted
   */
  subscribe: async (eventName: string, callback: Function) => {
    if (typeof callback !== "function") {
      throw new Error("Callback must be a function");
    }

    // Register with backend (tells backend to send this event to us)
    await ipcRenderer.invoke("event-subscribe", eventName);

    // Register callback locally
    if (!eventSubscriptions.has(eventName)) {
      eventSubscriptions.set(eventName, new Set());
    }
    eventSubscriptions.get(eventName)!.add(callback);
  },

  /**
   * Unsubscribe from an event
   * @param {string} eventName - Name of the event to unsubscribe from
   * @param {function} callback - The callback to remove
   */
  unsubscribe: async (eventName: string, callback: Function) => {
    const callbacks = eventSubscriptions.get(eventName);
    if (callbacks) {
      callbacks.delete(callback);

      // If no more callbacks, unregister from backend
      if (callbacks.size === 0) {
        eventSubscriptions.delete(eventName);
        await ipcRenderer.invoke("event-unsubscribe", eventName);
      }
    }
  },

  /**
   * Check if an event is supported
   * @param {string} eventName - Name of the event to check
   */
  isEventSupported: (eventName: string) => {
    return ipcRenderer.invoke("event-exists", eventName);
  },

  /**
   * Get the launch arguments passed to this app.
   * Fetches from main process - always returns current data.
   * @returns {Promise<string[]>} The launch arguments array
   */
  getLaunchArgs: (): Promise<string[]> => {
    return ipcRenderer
      .invoke("get-view-data")
      .then((data: any) => data.launchArgs || []);
  },
});

// ===================================================================
// AppBus - App-to-App Communication System
// ===================================================================

// Service handlers registered by this app
const registeredServices: Map<string, (method: string, args: any) => any> =
  new Map();

// Connected channels (client-side: connections to other apps' services)
const connectedPorts: Map<string, MessagePort> = new Map();

// Pending requests waiting for responses
const pendingRequests: Map<
  string,
  { resolve: (value: any) => void; reject: (reason: any) => void }
> = new Map();

// Handle incoming MessagePorts for peer-to-peer channels
ipcRenderer.on("appbus-port", (event: any, data: any) => {
  const [port] = event.ports as MessagePort[];
  if (!port) {
    console.error("[AppBus] Received appbus-port event without port");
    return;
  }

  const { connectionId, role, serviceName, targetAppId, sourceAppId } = data;

  if (role === "service") {
    // We're the service provider - set up message handler
    console.log(
      `[AppBus] Received connection from ${sourceAppId} for service ${serviceName}`
    );

    port.onmessage = (msgEvent: MessageEvent) => {
      const { type, method, payload, messageId } = msgEvent.data;

      const handler = registeredServices.get(serviceName);
      if (!handler) {
        port.postMessage({
          type: "response",
          messageId,
          error: `Service "${serviceName}" handler not found`,
        });
        return;
      }

      if (type === "request") {
        // Handle request (expects response)
        try {
          const result = handler(method, payload);
          // Handle both sync and async handlers
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
      } else if (type === "message") {
        // Fire-and-forget message
        try {
          handler(method, payload);
        } catch (err) {
          console.error(
            `[AppBus] Error handling message for ${serviceName}:`,
            err
          );
        }
      }
    };

    port.start();
  } else if (role === "client") {
    // We're the client - store the port for sending messages
    console.log(`[AppBus] Connected to ${targetAppId}/${serviceName}`);
    connectedPorts.set(connectionId, port);

    // Set up response handler
    port.onmessage = (msgEvent: MessageEvent) => {
      const { type, messageId, payload, error } = msgEvent.data;

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
    };

    port.start();
  }
});

// Generate unique message IDs
let messageIdCounter = 0;
function generateMessageId(): string {
  return `msg-${Date.now()}-${++messageIdCounter}`;
}

// Expose appBus API for app-to-app communication
contextBridge.exposeInMainWorld("appBus", {
  /**
   * Register a service that other apps can connect to
   * @param {string} serviceName - Name of the service
   * @param {Function} handler - Function to handle incoming method calls (method, args) => result
   * @param {object} options - Optional: description, allowedClients, methods
   */
  exposeService: async (
    serviceName: string,
    handler: (method: string, args: any) => any,
    options?: {
      description?: string;
      allowedClients?: string[];
      methods?: string[];
    }
  ): Promise<{ success: boolean; error?: string }> => {
    if (typeof handler !== "function") {
      throw new Error("Handler must be a function");
    }

    // Register locally
    registeredServices.set(serviceName, handler);

    // Register with main process
    const result = await ipcRenderer.invoke(
      "shell-command",
      "appbus/register",
      {
        serviceName,
        methods: options?.methods || [],
        description: options?.description,
        allowedClients: options?.allowedClients,
      }
    );

    if (!result.success) {
      registeredServices.delete(serviceName);
    }

    return result;
  },

  /**
   * Unregister a service
   * @param {string} serviceName - Name of the service to unregister
   */
  unexposeService: async (
    serviceName: string
  ): Promise<{ success: boolean }> => {
    registeredServices.delete(serviceName);
    return ipcRenderer.invoke("shell-command", "appbus/unregister", {
      serviceName,
    });
  },

  /**
   * Connect to another app's service
   * @param {string} targetAppId - App ID of the target app
   * @param {string} serviceName - Name of the service to connect to
   * @returns {Promise} Connection object with send, request, and close methods
   */
  connect: async (
    targetAppId: string,
    serviceName: string
  ): Promise<
    | {
        send: (method: string, args?: any) => void;
        request: (method: string, args?: any) => Promise<any>;
        close: () => void;
      }
    | { error: string }
  > => {
    // Request connection through shell command (will trigger MessagePort transfer)
    const result = await ipcRenderer.invoke("shell-command", "appbus/connect", {
      targetAppId,
      serviceName,
    });

    if (!result.success) {
      return { error: result.error || "Connection failed" };
    }

    const { connectionId } = result;

    // Wait a bit for the port to be received
    await new Promise((resolve) => setTimeout(resolve, 50));

    const port = connectedPorts.get(connectionId);
    if (!port) {
      return { error: "MessagePort not received" };
    }

    return {
      /**
       * Send a fire-and-forget message
       */
      send: (method: string, args?: any) => {
        port.postMessage({ type: "message", method, payload: args });
      },

      /**
       * Send a request and wait for response
       */
      request: (method: string, args?: any): Promise<any> => {
        return new Promise((resolve, reject) => {
          const messageId = generateMessageId();
          pendingRequests.set(messageId, { resolve, reject });

          // Timeout after 30 seconds
          setTimeout(() => {
            if (pendingRequests.has(messageId)) {
              pendingRequests.delete(messageId);
              reject(new Error("Request timeout"));
            }
          }, 30000);

          port.postMessage({
            type: "request",
            method,
            payload: args,
            messageId,
          });
        });
      },

      /**
       * Close the connection
       */
      close: () => {
        connectedPorts.delete(connectionId);
        port.close();
      },
    };
  },

  /**
   * List all available services
   * @returns {Promise} Array of service info objects
   */
  listServices: async (): Promise<{
    services: Array<{
      appId: string;
      serviceName: string;
      methods: string[];
      description?: string;
    }>;
  }> => {
    return ipcRenderer.invoke("shell-command", "appbus/list", {});
  },

  /**
   * List services exposed by a specific app
   * @param {string} appId - App ID to query
   */
  listServicesByApp: async (
    appId: string
  ): Promise<{
    services: Array<{ appId: string; serviceName: string; methods: string[] }>;
  }> => {
    return ipcRenderer.invoke("shell-command", "appbus/list-by-app", { appId });
  },
});

console.log("Universal app preload loaded");
