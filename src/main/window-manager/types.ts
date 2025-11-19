import { Rectangle as Bounds, WebContentsView } from "electron";
import { AppManifest } from "../../types";

export type ViewMode = "floating" | "tiled";

export interface ViewInfo {
  view: WebContentsView;
  appId: string;
  manifest: AppManifest;
  bounds: Bounds;
  visible: boolean;
  mode: ViewMode;
  tileIndex?: number;
  zIndex?: number;
}
