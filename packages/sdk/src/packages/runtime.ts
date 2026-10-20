import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { RuntimeContexts } from "../execution/runtime-contexts";
import { Filesystem } from "../filesystem/service";
import { Permissions } from "../ipc/permissions";
import { IpcTransport } from "../ipc/transport";
import { RuntimeEnvironment } from "../runtime/environment";
import { Views } from "../views/service";
import { createPackageController } from "./controller-edenapi";
import { DlcResourceProtocols, DlcResourcesViews } from "./dlc-resources";
import {
  PackagesFilesystem,
  PackagesPermissions,
  PackagesRuntimeContexts,
} from "./ports";
import { createDlcResourceProtocols } from "./resource-adapter";
import { Packages } from "./service";

export const registerPackagesApi = Effect.gen(function* () {
  (yield* IpcTransport).registerController(
    createPackageController(yield* Packages),
  );
});
export const DlcResourcesPortsLive = Layer.effectContext(
  Effect.gen(function* () {
    const { platform } = yield* RuntimeEnvironment;
    return Context.make(DlcResourcesViews, yield* Views).pipe(
      Context.add(
        DlcResourceProtocols,
        createDlcResourceProtocols(platform.resources),
      ),
    );
  }),
);
export const PackagesPortsLive = Layer.mergeAll(
  Layer.effect(PackagesPermissions, Permissions),
  Layer.effect(PackagesFilesystem, Filesystem),
  Layer.effect(PackagesRuntimeContexts, RuntimeContexts),
);
