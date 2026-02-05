import {
  log,
  logFromConsole,
  setLogContext,
  type CallsiteInfo,
} from "../logging";
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

setLogContext({ appId });

const captureConsoleCallsite = (): CallsiteInfo | undefined => {
  const err = new Error();
  Error.captureStackTrace?.(err, captureConsoleCallsite);
  const stack = err.stack;
  if (!stack) return undefined;

  const lines = stack.split("\n").slice(1);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (
      trimmed.includes("backend-preload") ||
      trimmed.includes("/logging/") ||
      trimmed.includes("\\logging\\")
    ) {
      continue;
    }

    const match =
      trimmed.match(/\(([^)]+):(\d+):(\d+)\)$/) ??
      trimmed.match(/at\s+([^\s]+):(\d+):(\d+)$/);

    if (!match) continue;

    const file = match[1];
    const lineNumber = Number(match[2]);
    const columnNumber = Number(match[3]);

    if (!file || Number.isNaN(lineNumber)) continue;

    return {
      file,
      line: lineNumber,
      column: Number.isNaN(columnNumber) ? undefined : columnNumber,
    };
  }

  return undefined;
};

console.log = (...args: unknown[]) =>
  logFromConsole({ level: "info", args, callsite: captureConsoleCallsite() });
console.info = (...args: unknown[]) =>
  logFromConsole({ level: "info", args, callsite: captureConsoleCallsite() });
console.warn = (...args: unknown[]) =>
  logFromConsole({ level: "warn", args, callsite: captureConsoleCallsite() });
console.error = (...args: unknown[]) =>
  logFromConsole({ level: "error", args, callsite: captureConsoleCallsite() });
console.debug = (...args: unknown[]) =>
  logFromConsole({ level: "debug", args, callsite: captureConsoleCallsite() });
console.trace = (...args: unknown[]) =>
  logFromConsole({ level: "trace", args, callsite: captureConsoleCallsite() });

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

// Port for direct frontend<->backend communication (received from main)
let frontendPort: Electron.MessagePortMain | null = null;

// Port for IPC with main process (process.parentPort)
const parentPort = process.parentPort;
if (!parentPort) {
  log.error("Not running in utility process - parentPort not available");
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
 * Generate unique command ID
 */
function generateCommandId(): string {
  return `cmd-${appId}-${Date.now()}-${++commandIdCounter}`;
}

/**
 * Send a shell command to main process and wait for response
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
  appBusState,
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
          log.error(`Error in event callback for ${eventName}:`, err);
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
    log.info(`Shutdown requested`);
    process.exit(0);
  }
});

/**
 * Set up frontend port using createPortConnection
 */
function setupFrontendPort(port: Electron.MessagePortMain): void {
  const wrappedPort = wrapElectronPort(port);

  // Create connection using shared utility
  frontendConnection = createPortConnection(
    wrappedPort,
    "__frontend__",
    new Map([["__frontend__", wrappedPort]]),
    new Map(),
    createMessageIdGenerator("backend-to-frontend"),
  );
}

/**
 * Handle AppBus port connections (using shared utility)
 */
function handleAppBusPort(port: Electron.MessagePortMain, data: any): void {
  // Wrap Electron MessagePortMain to IPCPort interface
  const wrappedPort = wrapElectronPort(port);

  handlePortSetup(wrappedPort, data, appBusState);
}

/**
 * Load and execute the actual backend entry point
 */
async function loadBackendEntry(): Promise<void> {
  try {
    log.info(`Loading backend entry: ${backendEntry}`);
    await import(backendEntry);
    log.info(`Backend loaded successfully`);

    // Signal to main that we're ready
    parentPort!.postMessage({ type: "backend-ready" });
  } catch (error) {
    log.error(`Failed to load backend:`, error);
    parentPort!.postMessage({
      type: "backend-error",
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

/**
 * Wait for frontend port (if app has frontend) then load backend
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
            log.info(`Frontend port initialized`);
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
 * Get AppAPI connection
 * Throws if app has no frontend
 */
function getAppAPI(): AppBusConnection {
  if (!frontendConnection) {
    throw new Error(
      "AppAPI not available: This app has no frontend connection. " +
        "Ensure 'frontend.entry' is defined in manifest.json if you need frontend communication.",
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
