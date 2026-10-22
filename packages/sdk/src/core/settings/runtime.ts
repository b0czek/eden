import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { PackageCatalog } from "../../applications/packages/catalog";
import { Permissions } from "../ipc/permissions";
import { IpcTransport } from "../ipc/transport";
import { createSettingsController } from "./controller-edenapi";
import { SettingsCatalog } from "./ports";
import { Settings } from "./service";

export const registerSettingsApi = Effect.gen(function* () {
  (yield* IpcTransport).registerController(
    createSettingsController(yield* Settings, yield* Permissions),
  );
});
export const SettingsCatalogLive = Layer.effect(
  SettingsCatalog,
  Effect.map(PackageCatalog, (catalog) => ({
    getAppSettings: (appId: string) => catalog.getApp(appId)?.settings,
  })),
);
