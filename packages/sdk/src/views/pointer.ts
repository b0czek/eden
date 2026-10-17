import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import type * as Fiber from "effect/Fiber";
import * as FiberSet from "effect/FiberSet";
import * as Schedule from "effect/Schedule";
import { log } from "../logging";
import type { DisplayPort } from "../platform/ports";
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
  const forkPolling = yield* FiberSet.makeRuntime<never, void, never>();
  let _subscribers: Map<string, MouseUpdateCallback> = new Map();
  let _interval: Fiber.Fiber<void> | null = null;
  let _lastUpdateTime: number = 0;
  let _lastPosition: { x: number; y: number } = { x: 0, y: 0 };
  let _updateInterval: number;
  const _display = display;

  _updateInterval = updateInterval;

  function subscribe(id: string, callback: MouseUpdateCallback): void {
    // Add subscriber
    _subscribers.set(id, callback);

    // Start tracking if this is the first subscriber
    if (_subscribers.size === 1) {
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
    return _display.getCursorScreenPoint();
  }

  function isTracking(): boolean {
    return _interval !== null;
  }

  function getSubscriberCount(): number {
    return _subscribers.size;
  }

  function start(): void {
    if (_interval) return;

    _lastUpdateTime = Date.now();
    _lastPosition = getCurrentPosition();

    _interval = forkPolling(
      Effect.sync(() => {
        const now = Date.now();
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
        Effect.schedule(Schedule.spaced(Duration.millis(_updateInterval))),
        Effect.asVoid,
      ),
    );
  }

  function stop(): void {
    if (_interval) {
      _interval.interruptUnsafe();
      _interval = null;
    }
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
