import { contextBridge, ipcRenderer } from "electron";

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("edenAPI", {
  // System info
  getSystemInfo: () => ipcRenderer.invoke("system-info"),

  // Shell commands
  shellCommand: (command: string, args: any) =>
    ipcRenderer.invoke("shell-command", command, args),

  // Listen for system messages
  onSystemMessage: (callback: (message: any) => void) => {
    ipcRenderer.on("system-message", (_event, message) => callback(message));
  },

  // App management
  launchApp: (appId: string, bounds?: any) =>
    ipcRenderer.invoke("shell-command", "launch-app", { appId, bounds }),

  stopApp: (appId: string) =>
    ipcRenderer.invoke("shell-command", "stop-app", { appId }),

  installApp: (sourcePath: string) =>
    ipcRenderer.invoke("shell-command", "install-app", { sourcePath }),

  uninstallApp: (appId: string) =>
    ipcRenderer.invoke("shell-command", "uninstall-app", { appId }),

  // File system
  selectDirectory: () => ipcRenderer.invoke("select-directory"),
  selectFile: (options: any) => ipcRenderer.invoke("select-file", options),
});
