import * as Effect from "effect/Effect";
import { IpcTransport } from "../../core/ipc/transport";
import { Filesystem } from "../../platform/filesystem/service";
import { createFileOpenController } from "./controller-edenapi";
import { createFileOpenOperations } from "./operations";
import { FileOpen } from "./service";

export const registerFileOpenApi = Effect.gen(function* () {
  const fileOpen = yield* FileOpen;

  (yield* IpcTransport).registerController(
    createFileOpenController(
      fileOpen,
      createFileOpenOperations(fileOpen, {
        prepareVolumeOperation: (yield* Filesystem).prepareVolumeOperation,
      }),
    ),
  );
});
