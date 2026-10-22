import * as Effect from "effect/Effect";
import { IpcTransport } from "../../core/ipc/transport";
import { RuntimeEnvironment } from "../../runtime/environment";
import { createViewController } from "./controller-edenapi";
import { createViewInteractions } from "./interactions";
import { Views } from "./service";

export const registerViewsApi = Effect.gen(function* () {
  const views = yield* Views;
  const { platform } = yield* RuntimeEnvironment;
  const interactions = yield* createViewInteractions(views, platform.display);
  (yield* IpcTransport).registerController(
    createViewController(views, interactions),
  );
});
