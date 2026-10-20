import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { IpcTransport } from "../ipc/transport";
import { Backends } from "../processes/backends";
import { RuntimeEnvironment } from "../runtime/environment";
import { createAppChannelsController } from "./controller-edenapi";
import { AppChannelBackends, AppChannelTransport } from "./ports";
import { AppChannels } from "./service";

export const registerAppChannelsApi = Effect.gen(function* () {
  (yield* IpcTransport).registerController(
    createAppChannelsController(yield* AppChannels),
  );
});
export const AppChannelsPortsLive = Layer.effectContext(
  Effect.gen(function* () {
    const { platform } = yield* RuntimeEnvironment;
    return Context.make(AppChannelTransport, platform.appChannels).pipe(
      Context.add(AppChannelBackends, yield* Backends),
    );
  }),
);
