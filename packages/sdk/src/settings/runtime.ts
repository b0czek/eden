import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ExecutionContext } from "../execution/context";
import { IpcTransport } from "../ipc/transport";
import { PackageCatalog } from "../packages/catalog";
import { createSettingsController } from "./controller-edenapi";
import { SettingsAuthorization, SettingsCatalog } from "./ports";
import { Settings } from "./service";

export const registerSettingsApi = Effect.gen(function* () {
  (yield* IpcTransport).registerController(
    createSettingsController(yield* Settings),
  );
});
export const SettingsPortsLive = Layer.effectContext(
  Effect.gen(function* () {
    const catalog = yield* PackageCatalog;
    return Context.make(SettingsCatalog, {
      getAppSettings: (appId) => catalog.getApp(appId)?.settings,
    }).pipe(Context.add(SettingsAuthorization, yield* ExecutionContext));
  }),
);
