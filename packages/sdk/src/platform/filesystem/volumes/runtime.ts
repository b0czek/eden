import * as Effect from "effect/Effect";
import { ExecutionContext } from "../../../core/execution/context";
import { Permissions } from "../../../core/ipc/permissions";
import { IpcTransport } from "../../../core/ipc/transport";
import { createVolumeController } from "./controller-edenapi";
import { Volumes } from "./service";

export const registerVolumesApi = Effect.gen(function* () {
  (yield* Permissions).registerEventPermission("volume/changed", "volume/read");
  (yield* IpcTransport).registerController(
    createVolumeController(yield* Volumes, yield* ExecutionContext),
  );
});
