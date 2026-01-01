/**
 * Backend Runtime
 *
 * This module runs inside Electron's utility process (forked by BackendManager).
 * It provides the global `worker` object with `edenAPI` and `appBus` APIs,
 * mirroring the frontend's `window.edenAPI` and `window.appBus`.
 *
 * Environment variables expected:
 * - EDEN_APP_ID: The app's identifier
 * - EDEN_BACKEND_ENTRY: Path to the actual backend entry point
 * - EDEN_INSTALL_PATH: Path to the app's installation directory
 * - EDEN_MANIFEST: JSON-stringified app manifest
 */

import type { EdenAPI, AppBusAPI, AppBusConnection } from "@edenapp/types";

import type { WorkerGlobal } from "@edenapp/types/worker";

import {
  createMessageIdGenerator,
  handleAppBusPort as handlePortSetup,
  createPortConnection,
  createAppBusState,
  wrapElectronPort,
  handlePortClosed,
} from "./common/port-channel";

import {
  createEdenAPI,
  createAppBusAPI,
  type ShellTransport,
} from "./common/api-factory";

// Electron utility process extends the Node process with parentPort
// This is available when running inside utilityProcess.fork()
// We use Electron's types which should be available

// Get app info from environment
const appId = process.env.EDEN_APP_ID!;
const backendEntry = process.env.EDEN_BACKEND_ENTRY!;
const manifest = JSON.parse(process.env.EDEN_MANIFEST || "{}");

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
    console.error("[Backend Runtime] Failed to parse launch args:", e);
  }
}

// Port for direct frontend<->backend communication (received from main)
let frontendPort: Electron.MessagePortMain | null = null;

// Port for IPC with main process (process.parentPort)
const parentPort = process.parentPort;
if (!parentPort) {
  console.error(
    "[Backend Runtime] Not running in utility process - parentPort not available"
  );
  process.exit(1);
}

// Event subscriptions
const eventSubscriptions: Map<string, Set<Function>> = new Map();

// Pending shell command requests
const pendingCommands: Map<
  string,
  { resolve: (value: any) => void; reject: (reason: any) => void }
> = new Map();
let commandIdCounter = 0;

// AppBus state
const appBusState = createAppBusState("backend-appbus");

/**
 * Create a unique command identifier for tracking shell requests.
 *
 * @returns A unique command ID string composed of the app ID, the current timestamp, and an incrementing counter
 */
function generateCommandId(): string {
  return `cmd-${appId}-${Date.now()}-${++commandIdCounter}`;
}

/**
 * Send a shell command to the main process and await the response.
 *
 * @param command - The shell command to execute.
 * @param args - Arguments passed to the command; the object will be augmented with a `_callerAppId` property identifying this app.
 * @returns The value returned by the main process for the command.
 *
 * The returned promise rejects if the command times out (after 30 seconds) or if the main process responds with an error.
 */
async function shellCommand(command: string, args: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const commandId = generateCommandId();

    // Set timeout
    const timeout = setTimeout(() => {
      pendingCommands.delete(commandId);
      reject(new Error(`Shell command '${command}' timed out`));
    }, 30000);

    pendingCommands.set(commandId, {
      resolve: (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      reject: (reason) => {
        clearTimeout(timeout);
        reject(reason);
      },
    });

    parentPort!.postMessage({
      type: "shell-command",
      commandId,
      command,
      args: { ...args, _callerAppId: appId },
    });
  });
}

// ===================================================================
// Shared API Implementation
// ===================================================================

// Shell transport implementation using internal shellCommand
const shellTransport: ShellTransport = {
  exec: (command: string, args: any) => {
    return shellCommand(command, args);
  },
};

/**
 * Eden API implementation for utility process
 */
const edenAPI: EdenAPI = createEdenAPI(shellTransport, eventSubscriptions, {
  getLaunchArgs: () => launchArgs,
});

/**
 * AppBus API implementation for utility process
 */
const appBus: AppBusAPI = createAppBusAPI(
  { transport: shellTransport, isBackend: true },
  appBusState
);

// Frontend communication state
let frontendConnection: AppBusConnection | null = null;

// Check if this app has a frontend (from manifest)
const hasFrontend = !!manifest.frontend?.entry;

// appAPI will be set after frontend port is received (for apps with frontend)
// For backend-only apps, worker.appAPI will be undefined

/**
 * Handle messages from main process (via parentPort)
 */
parentPort.on("message", (event: Electron.MessageEvent) => {
  const message = event.data;

  if (message.type === "shell-command-response") {
    // Response to a shell command we sent
    const pending = pendingCommands.get(message.commandId);
    if (pending) {
      pendingCommands.delete(message.commandId);
      if (message.error) {
        pending.reject(new Error(message.error));
      } else {
        pending.resolve(message.result);
      }
    }
  } else if (message.type === "shell-event") {
    // Event notification from main
    const { eventName, payload } = message;
    const callbacks = eventSubscriptions.get(eventName);
    if (callbacks) {
      callbacks.forEach((callback) => {
        try {
          callback(payload);
        } catch (err) {
          console.error(
            `[Backend ${appId}] Error in event callback for ${eventName}:`,
            err
          );
        }
      });
    }
  } else if (message.type === "appbus-port") {
    // AppBus connection port
    const [port] = event.ports;
    if (port) {
      handleAppBusPort(port, message);
    }
  } else if (message.type === "appbus-port-closed") {
    // AppBus connection closed
    handlePortClosed(appBusState, message.connectionId);
  } else if (message.type === "shutdown") {
    // Graceful shutdown request
    console.log(`[Backend ${appId}] Shutdown requested`);
    process.exit(0);
  }
});

/**
 * Establishes the frontend AppBus connection using the provided Electron message port.
 *
 * Wraps the raw Electron MessagePortMain and creates a port-backed AppBus connection
 * stored in `frontendConnection`, identified as "__frontend__" and configured with
 * a backend-to-frontend message ID generator.
 *
 * @param port - The Electron message port received from the main process for frontend communication
 */
function setupFrontendPort(port: Electron.MessagePortMain): void {
  const wrappedPort = wrapElectronPort(port);

  // Create connection using shared utility
  frontendConnection = createPortConnection(
    wrappedPort,
    "__frontend__",
    new Map([["__frontend__", wrappedPort]]),
    new Map(),
    createMessageIdGenerator("backend-to-frontend")
  );
}

/**
 * Establishes an AppBus connection for an incoming Electron MessagePortMain.
 *
 * Wraps the provided Electron port and performs AppBus port setup using the backend's AppBus state.
 *
 * @param port - The incoming Electron MessagePortMain that carries AppBus messages
 * @param data - Connection setup payload (e.g., connection id and metadata) sent alongside the port
 */
function handleAppBusPort(port: Electron.MessagePortMain, data: any): void {
  // Wrap Electron MessagePortMain to IPCPort interface
  const wrappedPort = wrapElectronPort(port);

  handlePortSetup(wrappedPort, data, appBusState, `[Backend ${appId}]`);
}

/**
 * Load and execute the configured backend entry module for this app.
 *
 * On successful import, posts a `{ type: "backend-ready" }` message to the parent port.
 * If the import throws, posts a `{ type: "backend-error", error: string }` message with the error message and exits the process with code 1.
 */
async function loadBackendEntry(): Promise<void> {
  try {
    console.log(`[Backend ${appId}] Loading backend entry: ${backendEntry}`);
    await import(backendEntry);
    console.log(`[Backend ${appId}] Backend loaded successfully`);

    // Signal to main that we're ready
    parentPort!.postMessage({ type: "backend-ready" });
  } catch (error) {
    console.error(`[Backend ${appId}] Failed to load backend:`, error);
    parentPort!.postMessage({
      type: "backend-error",
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

/**
 * Initialize the backend runtime by waiting for a frontend port if the app has a frontend, then load the backend entry.
 *
 * If the app has a frontend, waits for an "init-port" message, assigns and initializes the frontend port (sets `frontendPort` and calls `setupFrontendPort`). Afterwards, loads the configured backend entry module.
 *
 * @returns `void` when frontend port handling (if required) and backend entry loading are complete.
 */
async function initializeBackend(): Promise<void> {
  if (hasFrontend) {
    // Wait for init-port message before loading backend
    await new Promise<void>((resolve) => {
      const handler = (event: Electron.MessageEvent) => {
        if (event.data.type === "init-port") {
          const [port] = event.ports;
          if (port) {
            frontendPort = port;
            setupFrontendPort(port);
            console.log(`[Backend ${appId}] Frontend port initialized`);
          }
          parentPort.removeListener("message", handler);
          resolve();
        }
      };
      parentPort.on("message", handler);
    });
  }

  // Now load backend - worker.appAPI is ready (for apps with frontend)
  await loadBackendEntry();
}

/**
 * Retrieve the established AppBus connection for the frontend.
 *
 * @returns The active `AppBusConnection` used to communicate with the frontend.
 * @throws If no frontend connection is established (the app has no frontend or the frontend port has not been received).
 */
function getAppAPI(): AppBusConnection {
  if (!frontendConnection) {
    throw new Error(
      "AppAPI not available: This app has no frontend connection. " +
        "Ensure 'frontend.entry' is defined in manifest.json if you need frontend communication."
    );
  }
  return frontendConnection;
}

/**
 * Set up the global worker object
 */
// For apps with frontend, appAPI will be set in initializeBackend after port is received
((globalThis as any).worker as WorkerGlobal) = {
  edenAPI,
  appBus,
  getAppAPI,
};

// Start initialization
initializeBackend();