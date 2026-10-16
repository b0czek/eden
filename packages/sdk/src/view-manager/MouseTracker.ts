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
export function createMouseTracker(
  display: Pick<DisplayPort, "getCursorScreenPoint">,
  updateInterval: number = 8,
) {
  let _subscribers: Map<string, MouseUpdateCallback> = new Map();
  let _interval: NodeJS.Timeout | null = null;
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

    _interval = setInterval(() => {
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
          log.error("Error in MouseTracker callback:", error);
        }
      }
    }, _updateInterval);
  }

  function stop(): void {
    if (_interval) {
      clearInterval(_interval);
      _interval = null;
    }
  }

  function dispose(): void {
    _subscribers.clear();
    stop();
  }
  return {
    subscribe,
    unsubscribe,
    getCurrentPosition,
    isTracking,
    getSubscriberCount,
    dispose,
  };
}

export type MouseTracker = ReturnType<typeof createMouseTracker>;
