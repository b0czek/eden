import type {
  EventData,
  EventName,
  OperationObservation,
  OperationSnapshot,
} from "@edenapp/types";
import { log } from "../../logging/logger";
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
export function createEventSubscriptions(
  transport: ShellTransport,
  listeners: Map<string, Set<EventSubscriptionCallback>>,
) {
  const subscriptions = new Map<string, Subscription>();

  async function subscribe<T extends EventName>(
    eventName: T,
    callback: (data: EventData<T>) => void,
    operation?: OperationObservation,
  ): Promise<void> {
    if (typeof callback !== "function")
      throw new Error("Callback must be a function");
    const key = subscriptionKey(eventName, operation);
    let subscription = subscriptions.get(key);
    if (!subscription) {
      subscription = {
        callbacks: new Map(),
        pending: Promise.resolve(),
        registered: false,
      };
      subscriptions.set(key, subscription);
    }
    const listener = callback as EventSubscriptionCallback;
    const existing = subscription.callbacks.get(listener);
    if (existing) return existing.ready;
    const entry = subscription;
    const registration: Registration = { ready: Promise.resolve() };
    entry.callbacks.set(listener, registration);
    let callbacks = listeners.get(key);
    if (!callbacks) {
      callbacks = new Set();
      listeners.set(key, callbacks);
    }
    callbacks.add(listener);
    registration.ready = enqueue(key, entry, async () => {
      if (entry.callbacks.get(listener) !== registration) return;
      if (!entry.registered) {
        await transport.exec("event/subscribe", { eventName, operation });
        entry.registered = true;
      }
    }).catch((error) => {
      // A failed older request must not remove a replacement registration.
      if (entry.callbacks.get(listener) === registration)
        remove(key, entry, listener);
      throw error;
    });
    return registration.ready;
  }

  function unsubscribe<T extends EventName>(
    eventName: T,
    callback: (data: EventData<T>) => void,
    operation?: OperationObservation,
  ): void {
    const key = subscriptionKey(eventName, operation);
    const entry = subscriptions.get(key);
    const listener = callback as EventSubscriptionCallback;
    if (!entry?.callbacks.has(listener)) return;
    remove(key, entry, listener);
    void enqueue(key, entry, async () => {
      if (entry.callbacks.size || !entry.registered) return;
      entry.registered = false;
      await transport.exec("event/unsubscribe", { eventName, operation });
    }).catch((error) =>
      log.error(`Failed to unsubscribe from ${eventName}:`, error),
    );
  }

  function remove(
    eventName: string,
    entry: Subscription,
    listener: EventSubscriptionCallback,
  ): void {
    entry.callbacks.delete(listener);
    const callbacks = listeners.get(eventName);
    callbacks?.delete(listener);
    if (!callbacks?.size) listeners.delete(eventName);
  }

  function enqueue(
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
        subscriptions.get(eventName) === entry
      )
        subscriptions.delete(eventName);
    });
    return request;
  }
  return { subscribe, unsubscribe };
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
      invokeEventListener(callback, eventName, payload);
    }
  }
}

/** Deliver a snapshot or event without leaking listener failures to its producer. */
export function invokeEventListener<T>(
  callback: (payload: T) => void | Promise<void>,
  eventName: string,
  payload: T,
): void {
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
