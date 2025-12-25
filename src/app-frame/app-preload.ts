const { contextBridge, ipcRenderer } = require("electron");

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

console.log("Universal app preload loaded");
