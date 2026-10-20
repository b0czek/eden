import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Filesystem } from "../filesystem/service";
import { IpcTransport } from "../ipc/transport";
import { createOperationController } from "./controller-edenapi";
import { OperationsFilesystem } from "./ports";
import { Operations } from "./service";

export const registerOperationsApi = Effect.gen(function* () {
  (yield* IpcTransport).registerController(
    createOperationController(yield* Operations),
  );
});
export const OperationsPortsLive = Layer.effect(
  OperationsFilesystem,
  Filesystem,
);
