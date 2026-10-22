import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { IpcTransport } from "../../core/ipc/transport";
import { RuntimeEnvironment } from "../../runtime/environment";
import { createFilesystemBrandingAssets } from "./assets";
import { createBrandingController } from "./controller-edenapi";
import { BrandingAssets, BrandingConfig } from "./ports";
import { Branding } from "./service";

export const registerBrandingApi = Effect.gen(function* () {
  (yield* IpcTransport).registerController(
    createBrandingController(yield* Branding),
  );
});
export const BrandingPortsLive = Layer.effectContext(
  Effect.gen(function* () {
    const { config, paths } = yield* RuntimeEnvironment;
    return Context.make(BrandingConfig, config.branding).pipe(
      Context.add(
        BrandingAssets,
        createFilesystemBrandingAssets(paths.appPath),
      ),
    );
  }),
);
