import type { DialogRuntimeController } from "./runtimeTypes.js";
import type { DialogController } from "./types.js";

const runtimeByController = new WeakMap<
  DialogController,
  DialogRuntimeController
>();

export const registerDialogRuntime = (
  controller: DialogController,
  runtime: DialogRuntimeController,
) => {
  runtimeByController.set(controller, runtime);
};

export const getDialogRuntime = (controller: DialogController) => {
  return runtimeByController.get(controller);
};
