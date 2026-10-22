import type { EdenKeyboardPlacementMode } from "@edenapp/types";
import * as Effect from "effect/Effect";
import { EDEN_SETTINGS_APP_ID } from "../../core/settings/constants";
import type { Settings } from "../../core/settings/service";
import type { KeyboardPreferences } from "./state";

export const KEYBOARD_SETTINGS = {
  enabled: "keyboard.enabled",
  autoShowOnFocus: "keyboard.autoShowOnFocus",
  placementMode: "keyboard.placementMode",
  showNumberRow: "keyboard.showNumberRow",
  interfaceScale: "general.interfaceScale",
} as const;

export function defaultKeyboardPreferences(): KeyboardPreferences {
  return {
    enabled: true,
    autoShowOnFocus: true,
    placementMode: "docked",
    showNumberRow: true,
    interfaceScale: 1,
  };
}

export function parsePlacementMode(
  value: string | undefined,
): EdenKeyboardPlacementMode {
  return value === "floating" ? "floating" : "docked";
}

export function parseInterfaceScale(value: string | undefined): number {
  const scale = Number.parseFloat(value ?? "");
  return Number.isFinite(scale) ? Math.max(0.5, Math.min(scale, 2)) : 1;
}

export function readKeyboardPreferences(settings: Pick<Settings, "get">) {
  return Effect.gen(function* () {
    const [
      enabled,
      autoShowOnFocus,
      placementMode,
      showNumberRow,
      interfaceScale,
    ] = yield* Effect.all(
      [
        settings.get(EDEN_SETTINGS_APP_ID, KEYBOARD_SETTINGS.enabled),
        settings.get(EDEN_SETTINGS_APP_ID, KEYBOARD_SETTINGS.autoShowOnFocus),
        settings.get(EDEN_SETTINGS_APP_ID, KEYBOARD_SETTINGS.placementMode),
        settings.get(EDEN_SETTINGS_APP_ID, KEYBOARD_SETTINGS.showNumberRow),
        settings.get(EDEN_SETTINGS_APP_ID, KEYBOARD_SETTINGS.interfaceScale),
      ],
      { concurrency: "unbounded" },
    );
    return {
      enabled: enabled !== "false",
      autoShowOnFocus: autoShowOnFocus !== "false",
      placementMode: parsePlacementMode(placementMode),
      showNumberRow: showNumberRow !== "false",
      interfaceScale: parseInterfaceScale(interfaceScale),
    };
  });
}
