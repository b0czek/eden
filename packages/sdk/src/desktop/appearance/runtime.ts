import * as Effect from "effect/Effect";
import { IpcTransport } from "../../core/ipc/transport";
import { createAppearanceController } from "./controller-edenapi";
import { Appearance } from "./service";

export const registerAppearanceApi = Effect.gen(function* () {
  (yield* IpcTransport).registerController(
    createAppearanceController(yield* Appearance),
  );
});
