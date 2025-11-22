const { contextBridge, ipcRenderer } = require("electron");

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("edenAPI", {
    // System info
    getSystemInfo: () => ipcRenderer.invoke("system-info"),

    // Shell commands
    shellCommand: (command, args) =>
        ipcRenderer.invoke("shell-command", command, args),

    // Listen for system messages
    onSystemMessage: (callback) => {
        ipcRenderer.on("system-message", (_event, message) => callback(message));
    },

    // App management
    launchApp: (appId, bounds) =>
        ipcRenderer.invoke("shell-command", "launch-app", { appId, bounds }),

    stopApp: (appId) =>
        ipcRenderer.invoke("shell-command", "stop-app", { appId }),

    installApp: (sourcePath) =>
        ipcRenderer.invoke("shell-command", "install-app", { sourcePath }),

    uninstallApp: (appId) =>
        ipcRenderer.invoke("shell-command", "uninstall-app", { appId }),

    // File system
    selectDirectory: () => ipcRenderer.invoke("select-directory"),
    selectFile: (options) => ipcRenderer.invoke("select-file", options),
});
