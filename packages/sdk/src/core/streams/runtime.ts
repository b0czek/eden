import * as Effect from "effect/Effect";
import { IpcTransport } from "../ipc/transport";
import { createStreamController } from "./controller-edenapi";
import { Streams } from "./service";

export const registerStreamsApi = Effect.gen(function* () {
  (yield* IpcTransport).registerController(
    createStreamController(yield* Streams),
  );
});
