import type {
  EventData,
  EventName,
  OperationObservation,
  OperationSnapshot,
} from "@edenapp/types";
import { log } from "../../logging";
import type { ShellTransport } from "./shell-transport";

export type EventSubscriptionCallback = (
  payload: unknown,
) => void | Promise<void>;

interface Registration {
  ready: Promise<void>;
}
interface Subscription {
  callbacks: Map<EventSubscriptionCallback, Registration>;
  pending: Promise<void>;
  registered: boolean;
}

function subscriptionKey(
  eventName: string,
  operation?: OperationObservation,
): string {
  return operation
    ? JSON.stringify([
        eventName,
        operation.handle.command,
        operation.handle.id,
        operation.terminalOnly === true,
      ])
    : eventName;
}

/** Own local listeners and serialize changes to each remote subscription. */
export class EventSubscriptions {
  private readonly subscriptions = new Map<string, Subscription>();

  constructor(
    private transport: ShellTransport,
    private listeners: Map<string, Set<EventSubscriptionCallback>>,
  ) {}

  async subscribe<T extends EventName>(
    eventName: T,
    callback: (data: EventData<T>) => void,
    operation?: OperationObservation,
  ): Promise<void> {
    if (typeof callback !== "function")
      throw new Error("Callback must be a function");
    const key = subscriptionKey(eventName, operation);
    let subscription = this.subscriptions.get(key);
    if (!subscription) {
      subscription = {
        callbacks: new Map(),
        pending: Promise.resolve(),
        registered: false,
      };
      this.subscriptions.set(key, subscription);
    }
    const listener = callback as EventSubscriptionCallback;
    const existing = subscription.callbacks.get(listener);
    if (existing) return existing.ready;
    const entry = subscription;
    const registration: Registration = { ready: Promise.resolve() };
    entry.callbacks.set(listener, registration);
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key)!.add(listener);
    registration.ready = this.enqueue(key, entry, async () => {
      if (entry.callbacks.get(listener) !== registration) return;
      if (!entry.registered) {
        await this.transport.exec("event/subscribe", { eventName, operation });
        entry.registered = true;
      }
    }).catch((error) => {
      // A failed older request must not remove a replacement registration.
      if (entry.callbacks.get(listener) === registration)
        this.remove(key, entry, listener);
      throw error;
    });
    return registration.ready;
  }

  unsubscribe<T extends EventName>(
    eventName: T,
    callback: (data: EventData<T>) => void,
    operation?: OperationObservation,
  ): void {
    const key = subscriptionKey(eventName, operation);
    const entry = this.subscriptions.get(key);
    const listener = callback as EventSubscriptionCallback;
    if (!entry?.callbacks.has(listener)) return;
    this.remove(key, entry, listener);
    void this.enqueue(key, entry, async () => {
      if (entry.callbacks.size || !entry.registered) return;
      entry.registered = false;
      await this.transport.exec("event/unsubscribe", { eventName, operation });
    }).catch((error) =>
      log.error(`Failed to unsubscribe from ${eventName}:`, error),
    );
  }

  private remove(
    eventName: string,
    entry: Subscription,
    listener: EventSubscriptionCallback,
  ): void {
    entry.callbacks.delete(listener);
    const callbacks = this.listeners.get(eventName);
    callbacks?.delete(listener);
    if (!callbacks?.size) this.listeners.delete(eventName);
  }

  private enqueue(
    eventName: string,
    entry: Subscription,
    task: () => Promise<void>,
  ): Promise<void> {
    const request = entry.pending.then(task);
    const pending = request.catch(() => undefined);
    entry.pending = pending;
    void pending.then(() => {
      if (
        entry.pending === pending &&
        !entry.registered &&
        !entry.callbacks.size &&
        this.subscriptions.get(eventName) === entry
      )
        this.subscriptions.delete(eventName);
    });
    return request;
  }
}

/** Isolate synchronous and asynchronous listener failures in both app runtimes. */
export function dispatchEvent(
  listeners: Map<string, Set<EventSubscriptionCallback>>,
  eventName: string,
  payload: unknown,
): void {
  const keys = [eventName];
  if (eventName === "operation/changed") {
    const snapshot = (payload as { snapshot: OperationSnapshot }).snapshot;
    keys.push(subscriptionKey(eventName, { handle: snapshot }));
    if (
      snapshot.status === "succeeded" ||
      snapshot.status === "failed" ||
      snapshot.status === "cancelled"
    )
      keys.push(
        subscriptionKey(eventName, { handle: snapshot, terminalOnly: true }),
      );
  }
  for (const key of keys) {
    const callbacks = listeners.get(key);
    if (!callbacks) continue;
    for (const callback of [...callbacks]) {
      if (!callbacks.has(callback)) continue;
      try {
        const result = callback(payload);
        if (result && typeof result.then === "function")
          void Promise.resolve(result).catch((error) =>
            log.error(`Error in event listener for ${eventName}:`, error),
          );
      } catch (error) {
        log.error(`Error in event listener for ${eventName}:`, error);
      }
    }
  }
}
