export interface NotificationCaller {
  appId?: string;
  webContentsId?: number;
}

export interface NotificationViews {
  resolve(webContentsId?: number): number | undefined;
  isAlive(viewId: number): boolean;
}
