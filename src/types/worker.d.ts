/**
 * Worker Global Type Definitions
 */

import type { EdenAPI, AppBusAPI } from "./ipc";

/**
 * Worker global - backend runtime namespace
 * Mirrors the frontend's window.* pattern
 */
export interface WorkerGlobal {
  edenAPI: EdenAPI;
  appBus: AppBusAPI;
}

/**
 * Backend worker globals
 * These are set by backend-runtime.ts for worker threads
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
