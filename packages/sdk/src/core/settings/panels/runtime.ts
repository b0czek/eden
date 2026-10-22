import * as Effect from "effect/Effect";
import { Permissions } from "../../ipc/permissions";
import { IpcTransport } from "../../ipc/transport";
import { createSettingsPanelsController } from "./controller-edenapi";
import { SettingsPanels } from "./service";

export const registerSettingsPanelsApi = Effect.gen(function* () {
  (yield* Permissions).registerEventPermission(
    "settings/panels-changed",
    "settings/panels",
  );
  (yield* IpcTransport).registerController(
    createSettingsPanelsController(yield* SettingsPanels),
  );
});
