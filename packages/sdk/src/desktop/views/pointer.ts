import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberHandle from "effect/FiberHandle";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import { log } from "../../platform/logging/logger";
import type { DisplayPort } from "../../platform/ports/types";
/**
 * Callback function for mouse updates
 */
export type MouseUpdateCallback = (position: {
  x: number;
  y: number;
  deltaTime: number;
}) => void;
export const createPointerTracking = Effect.fn(function* (
  display: Pick<DisplayPort, "getCursorScreenPoint">,
  updateInterval: number = 8,
) {
  const clock = yield* Clock.Clock;
  const polling = yield* FiberHandle.make<void, never>();
  const forkPolling = yield* FiberHandle.runtime(polling)<never>();
  const _subscribers = new Map<string, MouseUpdateCallback>();
  let _lastUpdateTime: number = 0;
  let _lastPosition: { x: number; y: number } = { x: 0, y: 0 };

  function subscribe(id: string, callback: MouseUpdateCallback): void {
    const wasEmpty = _subscribers.size === 0;
    _subscribers.set(id, callback);

    // Start tracking if this is the first subscriber
    if (wasEmpty) {
      start();
    }
  }

  function unsubscribe(id: string): void {
    _subscribers.delete(id);

    // Stop tracking if no more subscribers
    if (_subscribers.size === 0) {
      stop();
    }
  }

  function getCurrentPosition(): { x: number; y: number } {
    return display.getCursorScreenPoint();
  }

  function isTracking(): boolean {
    return _subscribers.size > 0;
  }

  function getSubscriberCount(): number {
    return _subscribers.size;
  }

  function start(): void {
    _lastUpdateTime = clock.currentTimeMillisUnsafe();
    _lastPosition = getCurrentPosition();

    forkPolling(
      Effect.sync(() => {
        const now = clock.currentTimeMillisUnsafe();
        const deltaTime = now - _lastUpdateTime;
        _lastUpdateTime = now;

        const currentPosition = getCurrentPosition();

        // Only emit if cursor has actually moved (skip unnecessary callbacks)
        if (
          Math.abs(currentPosition.x - _lastPosition.x) < 1 &&
          Math.abs(currentPosition.y - _lastPosition.y) < 1
        ) {
          return;
        }

        _lastPosition = currentPosition;

        // Notify all subscribers of the position change
        for (const callback of _subscribers.values()) {
          try {
            callback({ ...currentPosition, deltaTime });
          } catch (error) {
            log.error("Error in PointerTracking callback:", error);
          }
        }
      }).pipe(
        Effect.schedule(Schedule.spaced(Duration.millis(updateInterval))),
        Effect.asVoid,
      ),
    );
  }

  function stop(): void {
    const fiber = FiberHandle.getUnsafe(polling);
    if (Option.isSome(fiber)) fiber.value.interruptUnsafe();
  }

  function dispose(): void {
    _subscribers.clear();
    stop();
  }
  yield* Effect.addFinalizer(() => Effect.sync(dispose));
  return {
    subscribe,
    unsubscribe,
    getCurrentPosition,
    isTracking,
    getSubscriberCount,
  };
});

export type PointerTracking = Effect.Success<
  ReturnType<typeof createPointerTracking>
>;
