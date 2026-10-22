import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ExecutionContext } from "../../core/execution/context";
import { IpcTransport } from "../../core/ipc/transport";
import { createProcessController } from "./controller-edenapi";
import { ProcessesRouting } from "./ports";
import { Processes } from "./service";

export const registerProcessesApi = Effect.gen(function* () {
  (yield* IpcTransport).registerController(
    createProcessController(yield* Processes, yield* ExecutionContext),
  );
});
export const ProcessesRoutingLive = Layer.effect(
  ProcessesRouting,
  Effect.map(IpcTransport, (ipc) => ({
    updateRunningApps: ipc.updateRunningApps,
    removeBackendSubscriptions: ipc.eventSubscribers.removeBackendSubscriptions,
  })),
);
