import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { AppChannelLifecycle } from "../appbus/ports";
import { AppChannels } from "../appbus/service";
import { ExecutionContext } from "../execution/context";
import { IpcTransport } from "../ipc/transport";
import { createProcessController } from "./controller-edenapi";
import { ProcessesRouting } from "./ports";
import { Processes } from "./service";

export const registerProcessesApi = Effect.gen(function* () {
  (yield* IpcTransport).registerController(
    createProcessController(yield* Processes, yield* ExecutionContext),
  );
});
export const ProcessesPortsLive = Layer.effectContext(
  Effect.gen(function* () {
    const ipc = yield* IpcTransport;
    return Context.make(AppChannelLifecycle, yield* AppChannels).pipe(
      Context.add(ProcessesRouting, {
        updateRunningApps: ipc.updateRunningApps,
        removeBackendSubscriptions:
          ipc.eventSubscribers.removeBackendSubscriptions,
      }),
    );
  }),
);
