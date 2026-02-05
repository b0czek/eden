// Re-export the Eden library

export { EdenConfig } from "@edenapp/types";
export { Eden } from "./Eden";
export { IPCBridge } from "./ipc";
export type { LogContext, Logger, LoggerConfig, LogLevel } from "./logging";
// Logging exports
export {
  configureLogger,
  createLogger,
  getLoggerConfig,
  log,
  setLogContext,
} from "./logging";
// Re-export core managers for library usage
export { PackageManager } from "./package-manager";
export { BackendManager, ProcessManager } from "./process-manager";
export { UserManager } from "./user";
// Window management exports
export { ViewManager } from "./view-manager";
