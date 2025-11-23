// Re-export the Eden library
export { Eden, EdenConfig } from "./Eden";

// Re-export core managers for library usage
export { PackageManager } from "./package-manager/PackageManager";
export { ProcessManager } from "./process-manager/ProcessManager";
export { WorkerManager } from "./process-manager/WorkerManager";
export { IPCBridge } from "./core/IPCBridge";

// Window management exports
export { ViewManager, LayoutCalculator, MouseTracker } from "./view-manager";
