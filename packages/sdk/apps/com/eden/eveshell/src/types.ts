export interface AppInfo {
  id: string;
  name: string;
  isRunning: boolean;
  activity?: "launch" | "stop";
}

export interface ContextMenuPosition {
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
}
