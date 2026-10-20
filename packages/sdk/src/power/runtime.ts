import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Daemons } from "../daemon/service";
import { IpcTransport } from "../ipc/transport";
import { Processes } from "../processes/service";
import { RuntimeEnvironment } from "../runtime/environment";
import { createPowerHost } from "./adapters";
import { createPowerController } from "./controller-edenapi";
import { PowerDaemons, PowerHost, PowerProcesses } from "./ports";
import { Power } from "./service";

export const registerPowerApi = Effect.gen(function* () {
  (yield* IpcTransport).registerController(createPowerController(yield* Power));
});
export const PowerPortsLive = Layer.effectContext(
  Effect.gen(function* () {
    const { config } = yield* RuntimeEnvironment;
    return Context.make(PowerHost, createPowerHost(config.powerProvider)).pipe(
      Context.add(PowerDaemons, yield* Daemons),
      Context.add(PowerProcesses, yield* Processes),
    );
  }),
);
