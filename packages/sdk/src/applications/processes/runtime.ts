import * as Effect from "effect/Effect";
import { IpcTransport } from "../../core/ipc/transport";
import { createProcessController } from "./controller-edenapi";
import { Processes } from "./service";

export const registerProcessesApi = Effect.gen(function* () {
  (yield* IpcTransport).registerController(
    createProcessController(yield* Processes),
  );
});
