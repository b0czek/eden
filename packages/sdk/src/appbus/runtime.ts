import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { IpcTransport } from "../ipc/transport";
import { RuntimeEnvironment } from "../runtime/environment";
import { createAppChannelsController } from "./controller-edenapi";
import { AppChannelTransport } from "./ports";
import { AppChannels } from "./service";

export const registerAppChannelsApi = Effect.gen(function* () {
  (yield* IpcTransport).registerController(
    createAppChannelsController(yield* AppChannels),
  );
});
export const AppChannelTransportLive = Layer.effect(
  AppChannelTransport,
  Effect.map(RuntimeEnvironment, ({ platform }) => platform.appChannels),
);
