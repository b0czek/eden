import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { IpcTransport } from "../ipc/transport";
import { Views } from "../views/service";
import { createContextMenuController } from "./controller-edenapi";
import { ContextMenuViews } from "./ports";
import { ContextMenu } from "./service";
import { createContextMenuViews } from "./views";

export const registerContextMenuApi = Effect.gen(function* () {
  (yield* IpcTransport).registerController(
    createContextMenuController(yield* ContextMenu),
  );
});
export const ContextMenuPortsLive = Layer.effect(
  ContextMenuViews,
  Effect.map(Views, createContextMenuViews),
);
