import * as Effect from "effect/Effect";
import { Processes } from "../../applications/processes/service";
import { IpcTransport } from "../../core/ipc/transport";
import { RuntimeEnvironment } from "../../runtime/environment";
import { createSystemController } from "./controller-edenapi";

export const registerSystemApi = Effect.gen(function* () {
  const ipc = yield* IpcTransport;
  const { config } = yield* RuntimeEnvironment;
  const processes = yield* Processes;
  ipc.registerController(
    createSystemController(config, () =>
      processes.getRunningApps(true).map((instance) => instance.manifest.id),
    ),
  );
});
