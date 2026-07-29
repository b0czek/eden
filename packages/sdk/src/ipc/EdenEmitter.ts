import "reflect-metadata";
import type { EventData, EventName } from "@edenapp/types";
import { log } from "../logging";
import type { IPCBridge } from "./IPCBridge";

type EdenEventListener<T> = (payload: T) => void | Promise<void>;

/**
 * Base class for managers that emit events within a specific namespace.
 *
 * Provides type-safe event emission where:
 * - Event names are constrained to the namespace's events
 * - Payload types are automatically inferred
 * - Namespace is extracted from the @EdenNamespace decorator
 *
 * @example
 * ```typescript
 * interface ProcessNamespaceEvents {
 *   "launched": { instance: AppInstance };
 *   "stopped": { appId: string };
 * }
 *
 * @EdenNamespace("process")
 * class ProcessManager extends EdenEmitter<ProcessNamespaceEvents> {
 *   constructor(ipcBridge: IPCBridge) {
 *     super(ipcBridge);
 *   }
 *
 *   async launchApp() {
 *     this.notify("launched", { instance }); // Fully typed!
 *   }
 * }
 * ```
 */
export abstract class EdenEmitter<TEvents> {
  protected ipcBridge: IPCBridge;
  private readonly listeners = new Map<
    keyof TEvents,
    Set<EdenEventListener<TEvents[keyof TEvents]>>
  >();

  constructor(ipcBridge: IPCBridge) {
    this.ipcBridge = ipcBridge;
  }

  /**
   * Register an in-process notification listener.
   *
   * Local listeners are fire-and-forget. Use an explicit awaited manager call
   * for lifecycle transactions whose failure must affect the caller.
   */
  public on<K extends keyof TEvents>(
    event: K,
    listener: EdenEventListener<TEvents[K]>,
  ): () => void {
    let eventListeners = this.listeners.get(event);
    if (!eventListeners) {
      eventListeners = new Set();
      this.listeners.set(event, eventListeners);
    }

    eventListeners.add(listener as EdenEventListener<TEvents[keyof TEvents]>);

    return () => {
      eventListeners.delete(
        listener as EdenEventListener<TEvents[keyof TEvents]>,
      );
      if (eventListeners.size === 0) {
        this.listeners.delete(event);
      }
    };
  }

  /**
   * Emit an event within this manager's namespace.
   *
   * The namespace is automatically extracted from the @EdenNamespace decorator.
   * Event names and payloads are type-checked based on the TEvents generic parameter.
   *
   * @param event - Event name (without namespace prefix)
   * @param data - Event payload data
   */
  protected notify<K extends keyof TEvents>(event: K, data: TEvents[K]): void {
    // Extract namespace from the @EdenNamespace decorator
    const namespace = Reflect.getMetadata("eden:namespace", this.constructor);

    if (!namespace) {
      throw new Error(
        `${this.constructor.name} must be decorated with @EdenNamespace to use notify(). ` +
          `Add @EdenNamespace("your-namespace") to the class.`,
      );
    }

    // Construct full event name: "namespace/event"
    const fullEventName = `${namespace}/${String(event)}` as EventName;

    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      for (const listener of eventListeners) {
        try {
          const result = listener(data);
          if (result && typeof result.then === "function") {
            void result.catch((error) => {
              log.error(
                `Error in local listener for ${String(fullEventName)}:`,
                error,
              );
            });
          }
        } catch (error) {
          log.error(
            `Error in local listener for ${String(fullEventName)}:`,
            error,
          );
        }
      }
    }

    // Broadcast to all subscribed views
    this.ipcBridge.eventSubscribers.notify(
      fullEventName,
      data as EventData<typeof fullEventName>,
    );
  }

  /**
   * Emit an event to a specific subscriber within this manager's namespace.
   *
   * Similar to notify(), but targets a specific view instead of broadcasting.
   *
   * @param viewId - The view ID to send the event to
   * @param event - Event name (without namespace prefix)
   * @param data - Event payload data
   */
  protected notifySubscriber<K extends keyof TEvents>(
    viewId: number,
    event: K,
    data: TEvents[K],
  ): void {
    // Extract namespace from the @EdenNamespace decorator
    const namespace = Reflect.getMetadata("eden:namespace", this.constructor);

    if (!namespace) {
      throw new Error(
        `${this.constructor.name} must be decorated with @EdenNamespace to use notifySubscriber(). ` +
          `Add @EdenNamespace("your-namespace") to the class.`,
      );
    }

    // Construct full event name: "namespace/event"
    const fullEventName = `${namespace}/${String(event)}` as EventName;

    // Send to specific view
    this.ipcBridge.eventSubscribers.notifyView(
      viewId,
      fullEventName,
      data as EventData<typeof fullEventName>,
    );
  }
}
