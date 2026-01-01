import { contextBridge, ipcRenderer } from "electron";
import type {
  AppBusConnection,
  ServiceConnectCallback,
} from "../types/ipc/appbus";
import {
  type PendingRequest,
  type IPCPort,
  createMessageIdGenerator,
  handleAppBusPort,
  createPortConnection,
  createAppBusState,
  wrapDOMPort,
} from "./common/port-channel";
import {
  createEdenAPI,
  createAppBusAPI,
  type ShellTransport,
} from "./common/api-factory";

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
const eventSubscriptions: Map<string, Set<Function>> = new Map();

// Extract appId from process arguments
// Arguments are passed as --app-id=com.example.app
const appIdArg = process.argv.find((arg) => arg.startsWith("--app-id="));
if (appIdArg) {
  appId = appIdArg.split("=")[1];
  console.log(`[AppPreload] Initialized for app: ${appId}`);
} else {
  console.warn("[AppPreload] No app ID found in arguments");
}

// Extract launch args
let launchArgs: string[] = [];
const launchArgsArg = process.argv.find((arg) =>
  arg.startsWith("--launch-args=")
);
if (launchArgsArg) {
  try {
    const jsonStr = launchArgsArg.split("=").slice(1).join("=");
    launchArgs = JSON.parse(jsonStr);
  } catch (e) {
    console.error("[AppPreload] Failed to parse launch args:", e);
  }
}

// Handle receiving the backend MessagePort
ipcRenderer.on("backend-port", (event: any) => {
  const [port] = event.ports as MessagePort[];
  if (!port) {
    console.error("[AppPreload] Received backend-port event without port");
    return;
  }

  backendPort = port;
  console.log(`[AppPreload] Backend port received for app ${appId}`);

  // Wrap DOM MessagePort to IPCPort interface
  const wrappedPort = wrapDOMPort(port);

  // Create connection object - handles all message routing internally
  backendConnection = createPortConnection(
    wrappedPort,
    "__backend__",
    new Map([["__backend__", wrappedPort]]), // Dummy map since we won't close this
    pendingBackendRequests,
    generateBackendMessageId
  );
});

// Set up unified message listener for shell-message channel
ipcRenderer.on("shell-message", (_event: any, message: any) => {
  const { type, payload } = message;
  const callbacks = eventSubscriptions.get(type);

  if (callbacks) {
    callbacks.forEach((callback) => {
      try {
        callback(payload);
      } catch (err) {
        console.error(`Error in event listener for ${type}:`, err);
      }
    });
  }
});

// Helper to create connection-guarded methods
const requireConnection = <T extends (...args: any[]) => any>(
  fn: (conn: AppBusConnection) => T
): T => {
  return ((...args: any[]) => {
    if (!backendConnection) {
      throw new Error("Backend not connected");
    }
    return fn(backendConnection)(...args);
  }) as T;
};

// Expose safe API to the app
contextBridge.exposeInMainWorld("getAppAPI", () => {
  if (!backendConnection) {
    throw new Error(
      "AppAPI not available: Backend not connected. " +
        "This could mean the app has no backend, or the connection is not yet established."
    );
  }
  return backendConnection;
});

// ===================================================================
// Shared API Implementation
// ===================================================================

// Shell transport implementation using ipcRenderer
const shellTransport: ShellTransport = {
  exec: (command: string, args: any) => {
    return ipcRenderer.invoke("shell-command", command, args);
  },
};

// Expose edenAPI for shell commands and event subscriptions
contextBridge.exposeInMainWorld(
  "edenAPI",
  createEdenAPI(shellTransport, eventSubscriptions, {
    getLaunchArgs: () => launchArgs,
  })
);

// ===================================================================
// AppBus - App-to-App Communication System
// ===================================================================

const appBusState = createAppBusState("appbus");

// Handle incoming MessagePorts for peer-to-peer channels
ipcRenderer.on("appbus-port", (event: any, data: any) => {
  const [port] = event.ports as MessagePort[];
  if (!port) {
    console.error("[AppBus] Received appbus-port event without port");
    return;
  }

  // Wrap DOM MessagePort to IPCPort interface
  const wrappedPort = wrapDOMPort(port);

  handleAppBusPort(wrappedPort, data, appBusState, "[AppBus]");
});

// Expose appBus API for app-to-app communication
contextBridge.exposeInMainWorld(
  "appBus",
  createAppBusAPI({ transport: shellTransport }, appBusState)
);

console.log("Universal app preload loaded");
