/**
 * Universal App Preload
 * 
 * This preload is used by all apps and provides a safe API that only allows
 * communication with the app's own backend. The app cannot access other apps
 * or system resources directly - it must go through its backend.
 */

const { contextBridge, ipcRenderer } = require('electron');

// Per-app channel names (received from main process)
let appId = null;
let appChannel = null;
let appRequestChannel = null;
const messageListeners = [];

// Wait for initialization from main process
ipcRenderer.once('init-app-api', (_event, { appId: id, channel, requestChannel }) => {
  appId = id;
  appChannel = channel;
  appRequestChannel = requestChannel;
  
  console.log(`App API initialized for ${appId} on channel ${channel}`);
  
  // Set up listener for incoming messages from backend
  ipcRenderer.on(appChannel, (_event, message) => {
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

// Expose safe API to the app
contextBridge.exposeInMainWorld('appAPI', {
  /**
   * Send a message to this app's backend
   * @param {object} message - Message to send to backend
   */
  sendMessage: (message) => {
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
  sendRequest: async (message) => {
    if (!appRequestChannel) {
      throw new Error('App API not yet initialized');
    }
    return ipcRenderer.invoke(appRequestChannel, message);
  },

  /**
   * Listen for messages from this app's backend
   * @param {function} callback - Called when backend sends a message
   */
  onMessage: (callback) => {
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
  }
});

console.log('Universal app preload loaded');
