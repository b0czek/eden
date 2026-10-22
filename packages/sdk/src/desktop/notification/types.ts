import type { Notification } from "@edenapp/types";
import type * as Effect from "effect/Effect";

export interface NotificationCaller {
  appId?: string;
  webContentsId?: number;
}

/** Host callbacks compose their own capability failures without losing their cause. */
export type NotificationActionCallbacks = Record<
  string,
  (notification: Notification) => Effect.Effect<unknown, Error>
>;
