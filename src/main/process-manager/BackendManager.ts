import { utilityProcess, MessageChannelMain, UtilityProcess } from "electron";
import { EventEmitter } from "events";
import * as path from "path";
import { AppManifest } from "@edenapp/types";
import { singleton, injectable } from "tsyringe";

/**
 * BackendManager
 *
 * Manages utility processes for app backends.
 * Each app's backend code runs in an isolated utility process.
 * Uses Electron's utilityProcess for better main process integration
 * and MessageChannelMain for direct frontend<->backend communication.
 */
@singleton()
@injectable()
export class BackendManager extends EventEmitter {
  private backends: Map<string, UtilityProcess> = new Map();
  private backendData: Map<
    string,
    { manifest: AppManifest; installPath: string }
  > = new Map();

  /**
   * MessagePort pairs for frontend<->backend communication
   * The BackendManager holds references to the main-process side of ports
   */
  private backendPorts: Map<string, Electron.MessagePortMain> = new Map();

  /**
   * Create and start a utility process for an app backend
   */
  async createBackend(
    appId: string,
    manifest: AppManifest,
    installPath: string,
    launchArgs?: string[]
  ): Promise<{ backend: UtilityProcess }> {
    // Check if backend already exists
    if (this.backends.has(appId)) {
      throw new Error(`Backend for app ${appId} already exists`);
    }

    // Check if app has a backend
    const backendConfig = manifest.backend;
    if (!backendConfig?.entry) {
      throw new Error(`App ${appId} does not have a backend`);
    }

    const backendEntryPath = path.join(installPath, backendConfig.entry);

    // Path to the backend runtime that wraps the actual backend
    const runtimePath = path.join(
      __dirname,
      "../../app-runtime/backend-preload.js"
    );

    // Create utility process with the runtime as entry point
    const backend = utilityProcess.fork(
      runtimePath,
      [`--launch-args=${JSON.stringify(launchArgs || [])}`],
      {
        serviceName: `eden-backend-${appId}`,
        env: {
          ...process.env,
          EDEN_APP_ID: appId,
          EDEN_BACKEND_ENTRY: backendEntryPath,
          EDEN_INSTALL_PATH: installPath,
          EDEN_MANIFEST: JSON.stringify(manifest),
        },
      }
    );

    // Only create frontend<->backend MessageChannel if app has a frontend
    const hasFrontend = !!manifest.frontend?.entry;

    if (hasFrontend) {
      // Create MessageChannel for frontend<->backend communication
      const { port1, port2 } = new MessageChannelMain();

      // port1 goes to the backend (utility process)
      // port2 goes to the frontend (will be transferred via IPCBridge)
      backend.postMessage({ type: "init-port" }, [port1]);

      // Store port2 for later transfer to frontend
      this.backendPorts.set(appId, port2);
    }

    // Set up backend event handlers
    backend.on("message", (message: any) => {
      this.handleBackendMessage(appId, message);
    });

    backend.on("exit", (code) => {
      console.log(`Backend for app ${appId} exited with code ${code}`);
      this.backends.delete(appId);
      this.backendData.delete(appId);
      this.backendPorts.delete(appId);
      this.emit("backend-exit", { appId, code });
    });

    // Register backend early so it can receive responses to shell commands
    // during initialization (before backend-ready is sent)
    this.backends.set(appId, backend);
    this.backendData.set(appId, { manifest, installPath });

    // Wait for the backend to signal it's ready
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(
            new Error(`Backend ${appId} startup timed out after 10 seconds`)
          );
        }, 10000);

        const onMessage = (msg: any) => {
          if (msg.type === "backend-ready") {
            clearTimeout(timeout);
            backend.removeListener("message", onMessage);
            resolve();
          } else if (msg.type === "backend-error") {
            clearTimeout(timeout);
            backend.removeListener("message", onMessage);
            reject(new Error(msg.error));
          }
        };

        backend.on("message", onMessage);
      });
    } catch (error) {
      // Clean up on failure
      this.backends.delete(appId);
      this.backendData.delete(appId);
      this.backendPorts.delete(appId);
      throw error;
    }

    console.log(
      `Backend started for app ${appId}${
        hasFrontend ? " (with frontend port)" : " (backend-only)"
      }`
    );

    return { backend };
  }

  /**
   * Send a message to a backend's utility process (for IPC from main)
   */
  sendMessage(appId: string, message: any): boolean {
    const backend = this.backends.get(appId);
    if (!backend) {
      console.warn(`No backend found for app ${appId}`);
      return false;
    }

    try {
      console.log(`Sending message to backend ${appId}:`, message.type);
      backend.postMessage(message);
      return true;
    } catch (error) {
      console.error(`Failed to send message to backend ${appId}:`, error);
      return false;
    }
  }

  /**
   * Send a message with ports to a backend's utility process
   */
  sendPortToBackend(
    appId: string,
    message: any,
    ports: Electron.MessagePortMain[]
  ): boolean {
    const backend = this.backends.get(appId);
    if (!backend) {
      console.warn(`No backend found for app ${appId}`);
      return false;
    }

    try {
      console.log(
        `Sending message with ${ports.length} ports to backend ${appId}:`,
        message.type
      );
      backend.postMessage(message, ports);
      return true;
    } catch (error) {
      console.error(
        `Failed to send message with ports to backend ${appId}:`,
        error
      );
      return false;
    }
  }

  /**
   * Get the frontend port for an app (to transfer to renderer)
   */
  getFrontendPort(appId: string): Electron.MessagePortMain | undefined {
    return this.backendPorts.get(appId);
  }

  /**
   * Terminate a backend utility process
   */
  async terminateBackend(appId: string): Promise<void> {
    const backend = this.backends.get(appId);
    if (!backend) {
      console.warn(`No backend found for app ${appId}`);
      return;
    }

    try {
      // Create a promise that resolves when backend exits
      const exitPromise = new Promise<void>((resolve) => {
        backend.once("exit", () => {
          resolve();
        });
      });

      // Create a timeout promise (5 seconds)
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(`Backend ${appId} termination timed out after 5 seconds`)
          );
        }, 5000);
      });

      // Send graceful shutdown message first
      backend.postMessage({ type: "shutdown" });

      // Wait a bit for graceful shutdown
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Kill if still running
      if (this.backends.has(appId)) {
        backend.kill();
      }

      // Wait for either exit or timeout
      await Promise.race([exitPromise, timeoutPromise]);

      this.backends.delete(appId);
      this.backendData.delete(appId);

      // Close the port
      const port = this.backendPorts.get(appId);
      if (port) {
        port.close();
        this.backendPorts.delete(appId);
      }
    } catch (error) {
      console.error(`Failed to terminate backend ${appId}:`, error);
      // Force cleanup even on error
      this.backends.delete(appId);
      this.backendData.delete(appId);
      this.backendPorts.delete(appId);
      throw error;
    }
  }

  /**
   * Get backend by app ID
   */
  getBackend(appId: string): UtilityProcess | undefined {
    return this.backends.get(appId);
  }

  /**
   * Check if backend exists for app
   */
  hasBackend(appId: string): boolean {
    return this.backends.has(appId);
  }

  /**
   * Get all running backend IDs
   */
  getRunningBackends(): string[] {
    return Array.from(this.backends.keys());
  }

  /**
   * Handle messages from backends (for system-level IPC)
   */
  private handleBackendMessage(appId: string, message: any): void {
    // Emit event for IPC bridge to handle
    this.emit("backend-message", {
      appId,
      message,
    });
  }

  /**
   * Terminate all backends
   */
  async terminateAll(): Promise<void> {
    const terminationPromises = Array.from(this.backends.keys()).map((appId) =>
      this.terminateBackend(appId)
    );
    await Promise.all(terminationPromises);
  }
}
