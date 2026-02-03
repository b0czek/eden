// Foundation Preload Script
// Provides safe IPC communication for the foundation layer

const { contextBridge, ipcRenderer } = require("electron");
const { log, setLogContext } = require("../logging");

setLogContext({ source: "foundation-preload" });

// Check for title argument
const titleArg = process.argv.find(arg => arg.startsWith('--window-title='));
if (titleArg) {
    const title = titleArg.split('=')[1];
    if (title) {
        // Set immediately
        try { document.title = title; } catch(e) {}
        
        // Also ensure it sticks after DOM load
        window.addEventListener('DOMContentLoaded', () => {
             document.title = title;
        });
    }
}

// Event subscription system
const eventSubscriptions = new Map();

// Set up unified message listener for shell-message channel
ipcRenderer.on("shell-message", (_event, message) => {
    const { type, payload } = message;
    const callbacks = eventSubscriptions.get(type);

    if (callbacks) {
        callbacks.forEach((callback) => {
            try {
                callback(payload);
            } catch (err) {
                log.error(`Error in event listener for ${type}:`, err);
            }
        });
    }
});

// Expose a safe edenAPI to the foundation renderer
contextBridge.exposeInMainWorld("edenAPI", {
    // Shell commands
    shellCommand: (command, args) => {
        return ipcRenderer.invoke("shell-command", command, args);
    },

    // Event subscription
    subscribe: async (eventName, callback) => {
        if (typeof callback !== "function") {
            throw new Error("Callback must be a function");
        }

        // Register with backend
        await ipcRenderer.invoke("shell-command", "event/subscribe", { eventName });

        // Register callback locally
        if (!eventSubscriptions.has(eventName)) {
            eventSubscriptions.set(eventName, new Set());
        }
        eventSubscriptions.get(eventName).add(callback);
    },

    unsubscribe: async (eventName, callback) => {
        const callbacks = eventSubscriptions.get(eventName);
        if (callbacks) {
            callbacks.delete(callback);

            // If no more callbacks, unregister from backend
            if (callbacks.size === 0) {
                eventSubscriptions.delete(eventName);
                await ipcRenderer.invoke("shell-command", "event/unsubscribe", { eventName });
            }
        }
    }
});

log.info("Foundation preload script loaded");
