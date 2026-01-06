// Re-export the Eden library
export { Eden } from "./Eden";
export { EdenConfig } from "../types";

// Re-export core managers for library usage
export { PackageManager } from "./package-manager";
export { ProcessManager, BackendManager } from "./process-manager";
export { IPCBridge } from "./ipc";

// Window management exports
export { ViewManager, LayoutCalculator, MouseTracker } from "./view-manager";
