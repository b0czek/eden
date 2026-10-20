import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { IpcTransport } from "../ipc/transport";
import { Settings } from "../settings/service";
import { createAppearanceController } from "./controller-edenapi";
import { AppearanceSettings } from "./ports";
import { Appearance } from "./service";
import { createAppearanceSettings } from "./settings-adapter";

export const registerAppearanceApi = Effect.gen(function* () {
  (yield* IpcTransport).registerController(
    createAppearanceController(yield* Appearance),
  );
});
export const AppearancePortsLive = Layer.effect(
  AppearanceSettings,
  Effect.map(Settings, createAppearanceSettings),
);
