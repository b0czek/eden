import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { IpcTransport } from "../ipc/transport";
import { Settings } from "../settings/service";
import { createI18nController } from "./controller-edenapi";
import { I18n, I18nSettings } from "./service";
import { createI18nSettings } from "./settings";

export const registerI18nApi = Effect.gen(function* () {
  (yield* IpcTransport).registerController(createI18nController(yield* I18n));
});
export const I18nSettingsLive = Layer.effect(
  I18nSettings,
  Effect.map(Settings, createI18nSettings),
);
