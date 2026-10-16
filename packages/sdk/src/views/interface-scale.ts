import type { AppManifest } from "@edenapp/types";
import * as Effect from "effect/Effect";
import * as v from "valibot";
import { listen } from "../events/scoped";
import { log } from "../logging";
import { EDEN_SETTINGS_APP_ID } from "../settings/constants";
import type { Settings } from "../settings/service";
import { interfaceScaleSchema } from "./schemas";
import type { ViewInfo, ViewType } from "./types";

const INTERFACE_SCALE_KEY = "general.interfaceScale";

export const createInterfaceScale = Effect.fn(function* (
  settings: Pick<Settings, "get" | "changed">,
  getViews: () => Iterable<ViewInfo>,
  notifyScaleChanged: (scale: number, previousScale: number) => void = () => {},
) {
  let currentScale = 1;
  const storedScale = (value: string) => {
    const parsed = v.safeParse(interfaceScaleSchema, parseFloat(value));
    return parsed.success ? parsed.output : undefined;
  };
  function setScale(scale: number) {
    const previousScale = currentScale;
    currentScale = scale;
    for (const view of getViews()) applyToView(view);
    notifyScaleChanged(scale, previousScale);
  }
  yield* listen(settings.changed, (data) => {
    if (data.appId !== EDEN_SETTINGS_APP_ID || data.key !== INTERFACE_SCALE_KEY)
      return;
    const scale = storedScale(data.value);
    if (scale !== undefined) setScale(scale);
  });
  const initialize = Effect.fn(function* () {
    const value = yield* settings
      .get(EDEN_SETTINGS_APP_ID, INTERFACE_SCALE_KEY)
      .pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            log.error("Failed to initialize interface scale:", error);
            return undefined;
          }),
        ),
      );
    if (value === undefined) return;
    const scale = storedScale(value);
    if (scale !== undefined) setScale(scale);
  });
  function getScalingMode(
    manifest: AppManifest,
    viewType: ViewType,
  ): "auto" | "manual" {
    return (
      manifest.window?.scaling ?? (viewType === "overlay" ? "manual" : "auto")
    );
  }
  function applyToView(view: ViewInfo) {
    try {
      if (
        view.view.webContents.isDestroyed() ||
        getScalingMode(view.manifest, view.viewType) === "manual"
      )
        return;
      view.view.webContents.setZoomFactor(currentScale);
    } catch (error) {
      log.error(`Failed to set zoom for view ${view.id}:`, error);
    }
  }
  return { initialize, getScale: () => currentScale, setScale, applyToView };
});
export type InterfaceScale = Effect.Success<
  ReturnType<typeof createInterfaceScale>
>;
