import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Filesystem } from "../filesystem/service";
import { IpcTransport } from "../ipc/transport";
import { Notifications } from "../notification/service";
import { Processes } from "../processes/service";
import { Views } from "../views/service";
import {
  createFilePickerFiles,
  createFilePickerNotifications,
  createFilePickerProcesses,
  createFilePickerViews,
} from "./adapters";
import { createFilePickerController } from "./controller-edenapi";
import {
  FilePickerFiles,
  FilePickerNotifications,
  FilePickerProcesses,
  FilePickerViews,
} from "./ports";
import { FilePicker } from "./service";

export const registerFilePickerApi = Effect.gen(function* () {
  (yield* IpcTransport).registerController(
    createFilePickerController(yield* FilePicker),
  );
});
export const FilePickerPortsLive = Layer.effectContext(
  Effect.gen(function* () {
    return Context.make(
      FilePickerViews,
      createFilePickerViews(yield* Views),
    ).pipe(
      Context.add(
        FilePickerProcesses,
        createFilePickerProcesses(yield* Processes),
      ),
      Context.add(FilePickerFiles, createFilePickerFiles(yield* Filesystem)),
      Context.add(
        FilePickerNotifications,
        createFilePickerNotifications(yield* Notifications),
      ),
    );
  }),
);
