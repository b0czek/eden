import * as Effect from "effect/Effect";
import { IpcTransport } from "../ipc/transport";
import { createSessionController } from "./controller-edenapi";
import { Sessions } from "./service";

export const registerSessionsApi = Effect.gen(function* () {
  (yield* IpcTransport).registerController(
    createSessionController(yield* Sessions),
  );
});
