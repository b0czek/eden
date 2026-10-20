import * as Effect from "effect/Effect";
import { IpcTransport } from "../ipc/transport";
import { createOperationController } from "./controller-edenapi";
import { Operations } from "./service";

export const registerOperationsApi = Effect.gen(function* () {
  (yield* IpcTransport).registerController(
    createOperationController(yield* Operations),
  );
});
