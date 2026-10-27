import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { IpcTransport } from "../../core/ipc/transport";
import { Views } from "../views/service";
import { createFilePickerController } from "./controller-edenapi";
import { FilePickerViews } from "./ports";
import { FilePicker } from "./service";
import { createFilePickerViews } from "./views";

export const registerFilePickerApi = Effect.gen(function* () {
  (yield* IpcTransport).registerController(
    createFilePickerController(yield* FilePicker),
  );
});
export const FilePickerViewsLive = Layer.effect(
  FilePickerViews,
  Effect.map(Views, createFilePickerViews),
);
