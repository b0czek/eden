const { contextBridge, ipcRenderer } = require("electron");

const CHANNEL_STATE_CHANGED = "eden-keyboard:state-changed";
const keyboardStateListeners = new Set();
let currentKeyboardState = {
  enabled: true,
  visible: false,
  placementMode: "docked",
  bottomInset: 0,
  layout: "text",
  showNumberRow: true,
};

ipcRenderer.on(CHANNEL_STATE_CHANGED, (_event, state) => {
  currentKeyboardState = state;

  for (const listener of keyboardStateListeners) {
    try {
      listener(state);
    } catch (error) {
      console.error("Keyboard state listener failed:", error);
    }
  }
});

contextBridge.exposeInMainWorld("edenKeyboard", {
  show: () => {
    return ipcRenderer.invoke("eden-keyboard:show");
  },
  sendAction: (action) => {
    return ipcRenderer.invoke("eden-keyboard:send-action", action);
  },
  hide: () => {
    return ipcRenderer.invoke("eden-keyboard:hide");
  },
  getState: () => {
    return Promise.resolve(currentKeyboardState);
  },
  onStateChanged: (callback) => {
    if (typeof callback !== "function") {
      return () => {};
    }

    keyboardStateListeners.add(callback);
    callback(currentKeyboardState);

    return () => {
      keyboardStateListeners.delete(callback);
    };
  },
});

console.log("Keyboard preload script loaded");
