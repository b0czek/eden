export interface ContextMenuCaller {
  appId?: string;
  webContentsId?: number;
}

export interface ContextMenuViews {
  resolve(webContentsId: number): number | undefined;
  get(viewId: number):
    | {
        alive: boolean;
        bounds: { x: number; y: number; width: number; height: number };
        scale: number;
      }
    | undefined;
  windowSize(): { width: number; height: number };
}
