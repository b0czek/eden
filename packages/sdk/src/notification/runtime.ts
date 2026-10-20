import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { IpcTransport } from "../ipc/transport";
import { Views } from "../views/service";
import { createNotificationController } from "./controller-edenapi";
import { NotificationViews } from "./ports";
import { Notifications } from "./service";
import { createNotificationViews } from "./views";

export const registerNotificationsApi = Effect.gen(function* () {
  (yield* IpcTransport).registerController(
    createNotificationController(yield* Notifications),
  );
});
export const NotificationsPortsLive = Layer.effect(
  NotificationViews,
  Effect.map(Views, createNotificationViews),
);
