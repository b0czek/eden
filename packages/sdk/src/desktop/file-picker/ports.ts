import type { ViewBounds } from "@edenapp/types";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type { FilePickerIoFailed } from "./errors";

export interface FilePickerViews {
  resolve(webContentsId?: number): number | undefined;
  get(viewId: number): { alive: boolean; bounds?: ViewBounds } | undefined;
  reveal(viewId: number): Effect.Effect<void, FilePickerIoFailed>;
}
export const FilePickerViews = Context.Service<
  "eden/FilePickerViews",
  FilePickerViews
>("eden/FilePickerViews");
