// Foundation Preload Script
// Provides safe IPC communication for the foundation layer

const { contextBridge, ipcRenderer } = require('electron');

// Expose a safe edenAPI to the foundation renderer
contextBridge.exposeInMainWorld('edenAPI', {
    // Shell commands
    shellCommand: (command, args) => {
        return ipcRenderer.invoke('shell-command', command, args);
    },

    // System messages
    onSystemMessage: (callback) => {
        ipcRenderer.on('system-message', (_event, message) => {
            callback(message);
        });
    },
});

console.log('Foundation preload script loaded');
