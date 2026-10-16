import type { ViewBounds } from "@edenapp/types";
import type * as Effect from "effect/Effect";
import type { Event } from "../events/event";
import type {
  DisplayPort,
  RendererIpcPort,
  WindowingPort,
} from "../platform/ports";
import type { Settings } from "../settings/service";

export interface KeyboardViews {
  resolve(webContentsId: number): { appId: string; viewId: number } | undefined;
  get(
    viewId: number,
  ): { visible: boolean; bounds: ViewBounds; scale: number } | undefined;
  list(): readonly number[];
  send(viewId: number, channel: string, payload: unknown): boolean;
  setPresentationLift(lift: number): void;
  boundsChanged: Pick<Event<{ workspaceBounds: ViewBounds }>, "on">;
}

export interface KeyboardProcesses {
  stopped: Pick<Event<{ appId: string }>, "on">;
}

export interface KeyboardAssets {
  readonly frontendPath: string;
  readonly preloadPath: string;
  readonly available: Effect.Effect<boolean>;
}

export interface KeyboardDependencies {
  assets: KeyboardAssets;
  settings: Pick<Settings, "get" | "changed">;
  views: KeyboardViews;
  processes: KeyboardProcesses;
  windows: Pick<WindowingPort, "createWindow">;
  rendererIpc: RendererIpcPort;
  display: DisplayPort;
  /** Executes work only at the renderer/native callback boundary. */
  run<A>(work: Effect.Effect<A, Error>): Promise<A>;
}
