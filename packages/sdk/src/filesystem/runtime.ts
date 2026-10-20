import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ExecutionContext } from "../execution/context";
import { Permissions } from "../ipc/permissions";
import { IpcTransport } from "../ipc/transport";
import { Views } from "../views/service";
import { createVolumeController } from "./controller-edenapi";
import { createFilesystemController } from "./controller-edenapi-files";
import { FilesystemViews } from "./ports";
import { Filesystem } from "./service";
import { Volumes } from "./volumes";

export const registerFilesystemApi = Effect.gen(function* () {
  const ipc = yield* IpcTransport;
  const permissions = yield* Permissions;
  permissions.registerEventPermission("fs/changed", "fs/read");
  permissions.registerEventPermission("volume/changed", "volume/read");
  ipc.registerController(
    createVolumeController(yield* Volumes, yield* ExecutionContext),
  );
  ipc.registerController(createFilesystemController(yield* Filesystem));
});
export const FilesystemPortsLive = Layer.effectContext(
  Effect.gen(function* () {
    const views = yield* Views;
    return Context.make(FilesystemViews, {
      resolveViewId: views.getViewIdByWebContentsId,
      removed: views.viewRemoved,
    });
  }),
);
