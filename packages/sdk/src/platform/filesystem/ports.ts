import * as Context from "effect/Context";
import type { Event } from "../../core/events/event";

export interface FilesystemViews {
  resolveViewId(webContentsId: number): number | undefined;
  removed: Pick<Event<{ viewId: number; webContentsId: number }>, "on">;
}
export const FilesystemViews = Context.Service<
  "eden/FilesystemViews",
  FilesystemViews
>("eden/FilesystemViews");
