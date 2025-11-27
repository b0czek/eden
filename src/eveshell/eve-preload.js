const { contextBridge, ipcRenderer } = require("electron");

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("edenAPI", {
    // Shell commands
    shellCommand: (command, args) =>
        ipcRenderer.invoke("shell-command", command, args),

    // Event Subscription System (unified with app-preload)
    subscribe: async (eventName, callback) => {
        if (typeof callback !== 'function') {
            throw new Error('Callback must be a function');
        }

        // Register with backend (tells backend to send this event to us)
        await ipcRenderer.invoke('event/subscribe', eventName);

        // Setup local listener infrastructure if needed
        if (!window._edenEventListeners) {
            window._edenEventListeners = new Map();

            // Setup global listener once - using unified shell-message channel
            ipcRenderer.on("shell-message", (_event, message) => {
                const { type, payload } = message;
                const listeners = window._edenEventListeners.get(type);
                if (listeners) {
                    listeners.forEach(cb => {
                        try {
                            cb(payload);
                        } catch (e) {
                            console.error(`Error in event listener for ${type}:`, e);
                        }
                    });
                }
            });
        }

        // Register callback locally
        if (!window._edenEventListeners.has(eventName)) {
            window._edenEventListeners.set(eventName, new Set());
        }
        window._edenEventListeners.get(eventName).add(callback);
    },

    unsubscribe: async (eventName, callback) => {
        if (window._edenEventListeners && window._edenEventListeners.has(eventName)) {
            const listeners = window._edenEventListeners.get(eventName);
            listeners.delete(callback);

            // If no more listeners, unregister from backend
            if (listeners.size === 0) {
                window._edenEventListeners.delete(eventName);
                await ipcRenderer.invoke('event/unsubscribe', eventName);
            }
        }
    },

    isEventSupported: (eventName) => ipcRenderer.invoke("events/check-existence", eventName),

    // File system
    selectDirectory: () => ipcRenderer.invoke("select-directory"),
    selectFile: (options) => ipcRenderer.invoke("select-file", options),
});

