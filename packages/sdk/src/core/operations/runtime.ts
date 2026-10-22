import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Filesystem } from "../../platform/filesystem/service";
import { IpcTransport } from "../ipc/transport";
import { createOperationController } from "./controller-edenapi";
import { OperationTransitionPreparation } from "./ports";
import { Operations } from "./service";

export const OperationTransitionPreparationLive = Layer.effect(
  OperationTransitionPreparation,
  Effect.gen(function* () {
    const filesystem = yield* Filesystem;
    return {
      prepareSession: (sessionId: string) =>
        filesystem.releaseHandles(sessionId),
      prepareRuntime: () => filesystem.releaseHandles(),
    } satisfies OperationTransitionPreparation;
  }),
);

export const registerOperationsApi = Effect.gen(function* () {
  (yield* IpcTransport).registerController(
    createOperationController(yield* Operations),
  );
});
