import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { IpcTransport } from "../../core/ipc/transport";
import { RuntimeEnvironment } from "../../runtime/environment";
import { createPackageController } from "./controller-edenapi";
import { DlcResourceProtocols } from "./dlc-resources";
import { createDlcResourceProtocols } from "./resource-adapter";
import { Packages } from "./service";

export const registerPackagesApi = Effect.gen(function* () {
  (yield* IpcTransport).registerController(
    createPackageController(yield* Packages),
  );
});
export const DlcResourcesPortsLive = Layer.effect(
  DlcResourceProtocols,
  Effect.gen(function* () {
    const { platform } = yield* RuntimeEnvironment;
    return createDlcResourceProtocols(platform.resources);
  }),
);
