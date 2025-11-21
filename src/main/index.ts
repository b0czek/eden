// Re-export the Eden library
export { Eden, EdenConfig } from "./Eden";

// Re-export core managers for library usage
export { AppManager } from "./core/AppManager";
export { WorkerManager } from "./core/WorkerManager";
export { IPCBridge } from "./core/IPCBridge";

// Window management exports
export { ViewManager, LayoutCalculator, MouseTracker } from "./view-manager";
