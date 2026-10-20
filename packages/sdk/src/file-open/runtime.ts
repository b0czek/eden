import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Filesystem } from "../filesystem/service";
import { IpcTransport } from "../ipc/transport";
import { Processes } from "../processes/service";
import { createFileOpenController } from "./controller-edenapi";
import { createFileOpenFilesystem } from "./filesystem";
import { createFileOpenOperations } from "./operations";
import { FileOpenFilesystem, FileOpenProcesses } from "./ports";
import { createFileOpenProcesses } from "./processes";
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
export const FileOpenPortsLive = Layer.effectContext(
  Effect.gen(function* () {
    return Context.make(
      FileOpenProcesses,
      createFileOpenProcesses(yield* Processes),
    ).pipe(
      Context.add(
        FileOpenFilesystem,
        yield* createFileOpenFilesystem(yield* Filesystem),
      ),
    );
  }),
);
