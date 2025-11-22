/**
 * Universal App Preload
 * 
 * This preload is used by all apps and provides a safe API that only allows
 * communication with the app's own backend. The app cannot access other apps
 * or system resources directly - it must go through its backend.
 */

const { contextBridge, ipcRenderer } = require('electron');

// Per-app channel names (received from main process)
let appId: string | null = null;
let appChannel: string | null = null;
let appRequestChannel: string | null = null;
const messageListeners: Array<(message: any) => void> = [];

// Bounds update listeners (for keeping renderer in sync)
const boundsListeners: Array<(bounds: any) => void> = [];

// Wait for initialization from main process
ipcRenderer.once('init-app-api', (_event: any, { appId: id, channel, requestChannel }: { appId: string; channel: string; requestChannel: string }) => {
  appId = id;
  appChannel = channel;
  appRequestChannel = requestChannel;
  
  console.log(`App API initialized for ${appId} on channel ${channel}`);
  
  // Set up listener for incoming messages from backend
  ipcRenderer.on(appChannel, (_event: any, message: any) => {
    // Notify all registered listeners
    messageListeners.forEach(callback => {
      try {
        callback(message);
      } catch (err) {
        console.error('Error in message listener:', err);
      }
    });
  });
});

// Listen for bounds updates from main process
ipcRenderer.on('bounds-updated', (_event: any, newBounds: any) => {
  boundsListeners.forEach(callback => {
    try {
      callback(newBounds);
    } catch (err) {
      console.error('Error in bounds listener:', err);
    }
  });
});

// Expose safe API to the app
contextBridge.exposeInMainWorld('appAPI', {
  /**
   * Send a message to this app's backend
   * @param {object} message - Message to send to backend
   */
  sendMessage: (message: any) => {
    if (!appChannel) {
      throw new Error('App API not yet initialized');
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
      throw new Error('App API not yet initialized');
    }
    return ipcRenderer.invoke(appRequestChannel, message);
  },

  /**
   * Listen for messages from this app's backend
   * @param {function} callback - Called when backend sends a message
   */
  onMessage: (callback: (message: any) => void) => {
    if (typeof callback !== 'function') {
      throw new Error('Callback must be a function');
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

  /**
   * Listen for bounds updates from the main process
   * @param {function} callback - Called when bounds are updated
   */
  onBoundsUpdated: (callback: (bounds: any) => void) => {
    if (typeof callback !== 'function') {
      throw new Error('Callback must be a function');
    }
    boundsListeners.push(callback);
  }
});

// Also expose edenAPI for shell commands (needed by app frame)
contextBridge.exposeInMainWorld('edenAPI', {
  /**
   * Execute shell commands (e.g., stop-app, set-view-visibility)
   * @param {string} command - The command to execute
   * @param {object} args - Command arguments
   * @returns {Promise} Command result
   */
  shellCommand: (command: string, args: any) => {
    return ipcRenderer.invoke('shell-command', command, args);
  }
});

console.log('Universal app preload loaded');
