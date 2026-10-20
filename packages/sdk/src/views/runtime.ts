import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { IpcTransport } from "../ipc/transport";
import { RuntimeEnvironment } from "../runtime/environment";
import { Settings } from "../settings/service";
import { createViewController } from "./controller-edenapi";
import { createViewInteractions } from "./interactions";
import { ViewsSettings } from "./ports";
import { Views } from "./service";

export const registerViewsApi = Effect.gen(function* () {
  const views = yield* Views;
  const { platform } = yield* RuntimeEnvironment;
  const interactions = yield* createViewInteractions(views, platform.display);
  (yield* IpcTransport).registerController(
    createViewController(views, interactions),
  );
});
export const ViewsPortsLive = Layer.effect(ViewsSettings, Settings);
