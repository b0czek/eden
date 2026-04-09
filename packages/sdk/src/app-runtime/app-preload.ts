import type { AppBusConnection } from "@edenapp/types/ipc/appbus";
import type { EdenKeyboardAction, EdenKeyboardAPI } from "@edenapp/types";
import { contextBridge, ipcRenderer } from "electron";
import { log, setLogContext } from "../logging";
import { createKeyboardActionController } from "./keyboard/actions";
import { createKeyboardAutodetection } from "./keyboard/autodetection";
import {
  createAppBusAPI,
  createEdenAPI,
  type ShellTransport,
} from "./common/api-factory";
import {
  type AppBusPortData,
  createAppBusState,
  createMessageIdGenerator,
  createPortConnection,
  handleAppBusPort,
  handlePortClosed,
  type PendingRequest,
  wrapDOMPort,
} from "./common/port-channel";

// Per-app state
let appId: string | null = null;

// MessagePort for direct frontend<->backend communication
let backendPort: MessagePort | null = null;
let backendConnection: AppBusConnection | null = null;

// Pending requests waiting for responses (for backend communication)
const pendingBackendRequests: Map<string, PendingRequest> = new Map();

// Message ID generator for backend communication
const generateBackendMessageId = createMessageIdGenerator("backend");

// Event subscription system
const eventSubscriptions: Map<
  string,
  Set<(payload: unknown) => void>
> = new Map();

const KEYBOARD_FOCUS_CHANNEL = "eden-keyboard:focus-state";
const KEYBOARD_SEND_ACTION_CHANNEL = "eden-keyboard:send-action";
const KEYBOARD_HIDE_CHANNEL = "eden-keyboard:hide";
const KEYBOARD_APPLY_ACTION_CHANNEL = "eden-keyboard:apply-action";

// Extract appId from process arguments
// Arguments are passed as --app-id=com.example.app
const appIdArg = process.argv.find((arg) => arg.startsWith("--app-id="));
if (appIdArg) {
  appId = appIdArg.split("=")[1];
  setLogContext({ appId });
  log.info(`Initialized for app: ${appId}`);
} else {
  log.warn("No app ID found in arguments");
}

// Extract launch args
let launchArgs: string[] = [];
const launchArgsArg = process.argv.find((arg) =>
  arg.startsWith("--launch-args="),
);
if (launchArgsArg) {
  try {
    const jsonStr = launchArgsArg.split("=").slice(1).join("=");
    launchArgs = JSON.parse(jsonStr);
  } catch (e) {
    log.error("Failed to parse launch args:", e);
  }
}

// Handle receiving the backend MessagePort
ipcRenderer.on("backend-port", (event) => {
  const [port] = event.ports as MessagePort[];
  if (!port) {
    log.error("Received backend-port event without port");
    return;
  }

  backendPort = port;
  log.info(`Backend port received for app ${appId}`);

  // Wrap DOM MessagePort to IPCPort interface
  const wrappedPort = wrapDOMPort(port);

  // Create connection object - handles all message routing internally
  backendConnection = createPortConnection(
    wrappedPort,
    "__backend__",
    new Map([["__backend__", wrappedPort]]), // Dummy map since we won't close this
    pendingBackendRequests,
    generateBackendMessageId,
  );
});

// Set up unified message listener for shell-message channel
ipcRenderer.on(
  "shell-message",
  (_event, message: { type: string; payload: unknown }) => {
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
  },
);

// Expose safe API to the app
contextBridge.exposeInMainWorld("getAppAPI", () => {
  if (!backendConnection) {
    throw new Error(
      "AppAPI not available: Backend not connected. " +
        "This could mean the app has no backend, or the connection is not yet established.",
    );
  }
  return backendConnection;
});

// ===================================================================
// Shared API Implementation
// ===================================================================

// Shell transport implementation using ipcRenderer
const shellTransport: ShellTransport = {
  exec: (command, args) => {
    return ipcRenderer.invoke("shell-command", command, args);
  },
};

// Expose edenAPI for shell commands and event subscriptions
const edenAPI = createEdenAPI(shellTransport, eventSubscriptions, {
  getLaunchArgs: () => launchArgs,
});

contextBridge.exposeInMainWorld("edenAPI", edenAPI);

const keyboardAPI: EdenKeyboardAPI = {
  sendAction: (action) =>
    ipcRenderer.invoke(KEYBOARD_SEND_ACTION_CHANNEL, action),
  hide: () => ipcRenderer.invoke(KEYBOARD_HIDE_CHANNEL),
};

contextBridge.exposeInMainWorld("edenKeyboard", keyboardAPI);

// ===================================================================
// AppBus - App-to-App Communication System
// ===================================================================

const appBusState = createAppBusState("appbus");

// Handle incoming MessagePorts for peer-to-peer channels
ipcRenderer.on("appbus-port", (event, data: AppBusPortData) => {
  const [port] = event.ports as MessagePort[];
  if (!port) {
    log.error("Received appbus-port event without port");
    return;
  }

  // Wrap DOM MessagePort to IPCPort interface
  const wrappedPort = wrapDOMPort(port);

  handleAppBusPort(wrappedPort, data, appBusState);
});

// Handle port closed notification
ipcRenderer.on(
  "appbus-port-closed",
  (_event, data: { connectionId: string }) => {
    handlePortClosed(appBusState, data.connectionId);
  },
);

// Expose appBus API for app-to-app communication
contextBridge.exposeInMainWorld(
  "appBus",
  createAppBusAPI({ transport: shellTransport }, appBusState),
);

const keyboardAutodetection = createKeyboardAutodetection({
  reportFocusState: (payload) => {
    ipcRenderer.send(KEYBOARD_FOCUS_CHANNEL, payload);
  },
});

const keyboardActionController = createKeyboardActionController(
  keyboardAutodetection,
);

const setupKeyboardIntegration = () => {
  keyboardAutodetection.setup();

  ipcRenderer.on(
    KEYBOARD_APPLY_ACTION_CHANNEL,
    (_event, action: EdenKeyboardAction) => {
      try {
        keyboardActionController.applyAction(action);
      } catch (error) {
        log.error("Failed to apply on-screen keyboard action:", error);
      }
    },
  );
};

// ===================================================================
// Universal Zoom Prevention
// ===================================================================
// Disable default browser zoom behavior for all apps
// This runs when the DOM is ready for all apps, regardless of app-frame usage

const setupZoomPrevention = () => {
  // Block Ctrl/Cmd + Plus/Minus/Equals for keyboard zoom
  document.addEventListener(
    "keydown",
    (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === "+" || e.key === "-" || e.key === "=" || e.key === "0")
      ) {
        e.preventDefault();
      }
    },
    { capture: true },
  );

  // Block Ctrl/Cmd + Mouse wheel for zoom
  document.addEventListener(
    "wheel",
    (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
      }
    },
    { passive: false, capture: true },
  );

  log.info("Zoom prevention enabled");
};

// Setup when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    setupZoomPrevention();
    setupKeyboardIntegration();
  });
} else {
  setupZoomPrevention();
  setupKeyboardIntegration();
}

log.info("Universal app preload loaded");
