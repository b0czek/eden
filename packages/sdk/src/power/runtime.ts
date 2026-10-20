import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { IpcTransport } from "../ipc/transport";
import { RuntimeEnvironment } from "../runtime/environment";
import { createPowerHost } from "./adapters";
import { createPowerController } from "./controller-edenapi";
import { PowerHost } from "./ports";
import { Power } from "./service";

export const registerPowerApi = Effect.gen(function* () {
  (yield* IpcTransport).registerController(createPowerController(yield* Power));
});
export const PowerHostLive = Layer.effect(
  PowerHost,
  Effect.map(RuntimeEnvironment, ({ config }) =>
    createPowerHost(config.powerProvider),
  ),
);
