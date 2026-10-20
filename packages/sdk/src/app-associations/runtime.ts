import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { IpcTransport } from "../ipc/transport";
import { RuntimeEnvironment } from "../runtime/environment";
import { createAppAssociationsController } from "./controller-edenapi";
import { createJsonFileAssociationStorage } from "./json-file";
import { AppAssociationStorage } from "./ports";
import { AppAssociations } from "./service";

export const registerAppAssociationsApi = Effect.gen(function* () {
  (yield* IpcTransport).registerController(
    createAppAssociationsController(yield* AppAssociations),
  );
});
export const AppAssociationsPortsLive = Layer.effect(
  AppAssociationStorage,
  Effect.gen(function* () {
    const { paths } = yield* RuntimeEnvironment;
    return createJsonFileAssociationStorage(paths.userDirectory);
  }),
);
