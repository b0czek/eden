import * as Context from "effect/Context";

export interface NotificationViews {
  resolve(webContentsId?: number): number | undefined;
  isAlive(viewId: number): boolean;
}
export const NotificationViews = Context.Service<
  "eden/NotificationViews",
  NotificationViews
>("eden/NotificationViews");
