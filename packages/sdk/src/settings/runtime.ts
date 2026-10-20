import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { IpcTransport } from "../ipc/transport";
import { PackageCatalog } from "../packages/catalog";
import { createSettingsController } from "./controller-edenapi";
import { SettingsCatalog } from "./ports";
import { Settings } from "./service";

export const registerSettingsApi = Effect.gen(function* () {
  (yield* IpcTransport).registerController(
    createSettingsController(yield* Settings),
  );
});
export const SettingsCatalogLive = Layer.effect(
  SettingsCatalog,
  Effect.map(PackageCatalog, (catalog) => ({
    getAppSettings: (appId: string) => catalog.getApp(appId)?.settings,
  })),
);
