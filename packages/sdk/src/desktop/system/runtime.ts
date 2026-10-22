import * as Effect from "effect/Effect";
import { IpcTransport } from "../../core/ipc/transport";
import { RuntimeEnvironment } from "../../runtime/environment";
import { createSystemController } from "./controller-edenapi";

export const registerSystemApi = Effect.gen(function* () {
  const ipc = yield* IpcTransport;
  const { config } = yield* RuntimeEnvironment;
  ipc.registerController(createSystemController(config, ipc.getRunningAppIds));
});
