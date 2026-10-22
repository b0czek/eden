import * as Effect from "effect/Effect";
import { createEvent, type Event, type EventListener } from "./event";

export function scopedEvent<T>() {
  return Effect.acquireRelease(
    Effect.sync(() => createEvent<T>()),
    (event) => Effect.sync(event.dispose),
  );
}

export function listen<T>(
  source: Pick<Event<T>, "on">,
  listener: EventListener<T>,
) {
  return Effect.acquireRelease(
    Effect.sync(() => source.on(listener)),
    (stop) => Effect.sync(stop),
  );
}
