import * as Effect from "effect/Effect";
import { IpcTransport } from "../ipc/transport";
import { createI18nController } from "./controller-edenapi";
import { I18n } from "./service";

export const registerI18nApi = Effect.gen(function* () {
  (yield* IpcTransport).registerController(createI18nController(yield* I18n));
});
