import * as Effect from "effect/Effect";
import { IpcTransport } from "../ipc/transport";
import { createDbController } from "./controller-edenapi";
import { Db } from "./service";

export const registerDbApi = Effect.gen(function* () {
  (yield* IpcTransport).registerController(createDbController(yield* Db));
});
