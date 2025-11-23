import { Worker } from "worker_threads";
import { EventEmitter } from "events";
import * as path from "path";
import { AppManifest, IPCMessage } from "../../types";

/**
 * WorkerManager
 *
 * Manages worker threads for app backends.
 * Each app's backend code runs in an isolated worker thread.
 */
export class WorkerManager extends EventEmitter {
  private workers: Map<string, Worker> = new Map();
  private workerData: Map<
    string,
    { manifest: AppManifest; installPath: string }
  > = new Map();

  /**
   * Create and start a worker for an app
   */
  async createWorker(
    appId: string,
    manifest: AppManifest,
    installPath: string
  ): Promise<Worker> {
    // Check if worker already exists
    if (this.workers.has(appId)) {
      throw new Error(`Worker for app ${appId} already exists`);
    }

    // Check if app has a backend
    const backendConfig = manifest.backend;
    if (!backendConfig?.entry) {
      throw new Error(`App ${appId} does not have a backend`);
    }

    const backendPath = path.join(installPath, backendConfig.entry);

    // Create worker with resource limits if specified
    const workerOptions = {
      workerData: {
        appId,
        manifest,
        installPath,
      },
      resourceLimits: backendConfig.options?.resourceLimits,
    };

    const worker = new Worker(backendPath, workerOptions);

    // Set up worker event handlers
    worker.on("message", (message: IPCMessage) => {
      this.handleWorkerMessage(appId, message);
    });

    worker.on("error", (error) => {
      console.error(`Worker error for app ${appId}:`, error);
      this.emit("worker-error", { appId, error });
    });

    worker.on("exit", (code) => {
      console.log(`Worker for app ${appId} exited with code ${code}`);
      this.workers.delete(appId);
      this.workerData.delete(appId);
      this.emit("worker-exit", { appId, code });
    });

    this.workers.set(appId, worker);
    this.workerData.set(appId, { manifest, installPath });

    return worker;
  }

  /**
   * Send a message to a worker
   */
  sendMessage(appId: string, message: IPCMessage): boolean {
    const worker = this.workers.get(appId);
    if (!worker) {
      console.warn(`No worker found for app ${appId}`);
      return false;
    }

    try {
      console.log(`Sending message to worker ${appId}:`, message.type);
      worker.postMessage(message);
      return true;
    } catch (error) {
      console.error(`Failed to send message to worker ${appId}:`, error);
      return false;
    }
  }

  /**
   * Terminate a worker
   */
  async terminateWorker(appId: string): Promise<void> {
    const worker = this.workers.get(appId);
    if (!worker) {
      console.warn(`No worker found for app ${appId}`);
      return;
    }

    try {
      // Create a promise that resolves when worker exits
      const exitPromise = new Promise<void>((resolve) => {
        worker.once("exit", () => {
          resolve();
        });
      });

      // Create a timeout promise (5 seconds)
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(`Worker ${appId} termination timed out after 5 seconds`)
          );
        }, 5000);
      });

      // Initiate termination
      const terminatePromise = worker.terminate();

      // Wait for either exit or timeout
      await Promise.race([exitPromise, timeoutPromise, terminatePromise]);

      this.workers.delete(appId);
      this.workerData.delete(appId);
    } catch (error) {
      console.error(`Failed to terminate worker ${appId}:`, error);
      // Force cleanup even on error
      this.workers.delete(appId);
      this.workerData.delete(appId);
      throw error;
    }
  }

  /**
   * Get worker by app ID
   */
  getWorker(appId: string): Worker | undefined {
    return this.workers.get(appId);
  }

  /**
   * Check if worker exists for app
   */
  hasWorker(appId: string): boolean {
    return this.workers.has(appId);
  }

  /**
   * Get all running worker IDs
   */
  getRunningWorkers(): string[] {
    return Array.from(this.workers.keys());
  }

  /**
   * Handle messages from workers
   */
  private handleWorkerMessage(appId: string, message: IPCMessage): void {
    // Emit event for IPC bridge to handle
    this.emit("worker-message", {
      appId,
      message,
    });
  }

  /**
   * Terminate all workers
   */
  async terminateAll(): Promise<void> {
    const terminationPromises = Array.from(this.workers.keys()).map((appId) =>
      this.terminateWorker(appId)
    );
    await Promise.all(terminationPromises);
  }
}
