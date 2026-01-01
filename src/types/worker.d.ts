/**
 * Worker Global Type Definitions
 *
 * Type definitions for the global `worker` object available in utility processes.
 * This mirrors the frontend's `window.edenAPI` and `window.appBus` pattern.
 */

import type { EdenAPI, AppBusAPI, AppBusConnection } from "./ipc";

/**
 * Worker global - backend runtime namespace
 * Mirrors the frontend's window.* pattern
 */
export interface WorkerGlobal {
  edenAPI: EdenAPI;
  appBus: AppBusAPI;
  getAppAPI: () => AppBusConnection;
}

/**
 * Backend globals (utility process)
 * These are set by backend-preload.ts for utility processes
 */
declare global {
  /**
   * Worker namespace (backend only)
   * Mirrors frontend's window.* pattern:
   * - Frontend: window.edenAPI, window.appBus
   * - Backend:  worker.edenAPI, worker.appBus
   */
  var worker: WorkerGlobal | undefined;
}
