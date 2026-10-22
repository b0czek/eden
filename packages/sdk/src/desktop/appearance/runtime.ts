import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { IpcTransport } from "../../core/ipc/transport";
import { Settings } from "../../core/settings/service";
import { createAppearanceController } from "./controller-edenapi";
import { AppearanceSettings } from "./ports";
import { Appearance } from "./service";
import { createAppearanceSettings } from "./settings";

export const registerAppearanceApi = Effect.gen(function* () {
  (yield* IpcTransport).registerController(
    createAppearanceController(yield* Appearance),
  );
});
export const AppearanceSettingsLive = Layer.effect(
  AppearanceSettings,
  Effect.map(Settings, createAppearanceSettings),
);
