// Foundation Preload Script
// Provides safe IPC communication for the foundation layer

const { contextBridge, ipcRenderer } = require('electron');

// Expose a safe edenAPI to the foundation renderer
contextBridge.exposeInMainWorld('edenAPI', {
    // Shell commands
    shellCommand: (command, args) => {
        return ipcRenderer.invoke('shell-command', command, args);
    },

});

console.log('Foundation preload script loaded');
