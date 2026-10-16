import { log } from "../logging";

export type EventListener<T> = (payload: T) => void | Promise<void>;

/** A local notification source with no transport or namespace dependency. */
export interface Event<T> {
  on(listener: EventListener<T>): () => void;
  emit(payload: T): void;
  hasListeners(): boolean;
  dispose(): void;
}

export function createEvent<T>(): Event<T> {
  const listeners = new Set<EventListener<T>>();
  return {
    on(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(payload) {
      for (const listener of [...listeners]) {
        if (!listeners.has(listener)) continue;
        try {
          const result = listener(payload);
          if (result && typeof result.then === "function")
            void result.catch((error) =>
              log.error("Event listener failed:", error),
            );
        } catch (error) {
          log.error("Event listener failed:", error);
        }
      }
    },
    hasListeners: () => listeners.size > 0,
    dispose: () => listeners.clear(),
  };
}
