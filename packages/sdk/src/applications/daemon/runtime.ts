import * as Effect from "effect/Effect";
import { ExecutionContext } from "../../core/execution/context";
import { IpcTransport } from "../../core/ipc/transport";
import { Users } from "../../core/user/service";
import { createDaemonController } from "./controller-edenapi";
import { Daemons } from "./service";

export const registerDaemonsApi = Effect.gen(function* () {
  (yield* IpcTransport).registerController(
    createDaemonController(
      yield* Daemons,
      yield* ExecutionContext,
      yield* Users,
    ),
  );
});
