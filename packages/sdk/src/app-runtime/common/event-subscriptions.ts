import type { EventData, EventName } from "@edenapp/types";
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
  ): Promise<void> {
    if (typeof callback !== "function")
      throw new Error("Callback must be a function");
    let subscription = this.subscriptions.get(eventName);
    if (!subscription) {
      subscription = {
        callbacks: new Map(),
        pending: Promise.resolve(),
        registered: false,
      };
      this.subscriptions.set(eventName, subscription);
    }
    const listener = callback as EventSubscriptionCallback;
    const existing = subscription.callbacks.get(listener);
    if (existing) return existing.ready;
    const entry = subscription;
    const registration: Registration = { ready: Promise.resolve() };
    entry.callbacks.set(listener, registration);
    if (!this.listeners.has(eventName))
      this.listeners.set(eventName, new Set());
    this.listeners.get(eventName)!.add(listener);
    registration.ready = this.enqueue(eventName, entry, async () => {
      if (entry.callbacks.get(listener) !== registration) return;
      if (!entry.registered) {
        await this.transport.exec("event/subscribe", { eventName });
        entry.registered = true;
      }
    }).catch((error) => {
      // A failed older request must not remove a replacement registration.
      if (entry.callbacks.get(listener) === registration)
        this.remove(eventName, entry, listener);
      throw error;
    });
    return registration.ready;
  }

  unsubscribe<T extends EventName>(
    eventName: T,
    callback: (data: EventData<T>) => void,
  ): void {
    const entry = this.subscriptions.get(eventName);
    const listener = callback as EventSubscriptionCallback;
    if (!entry?.callbacks.has(listener)) return;
    this.remove(eventName, entry, listener);
    void this.enqueue(eventName, entry, async () => {
      if (entry.callbacks.size || !entry.registered) return;
      entry.registered = false;
      await this.transport.exec("event/unsubscribe", { eventName });
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
  const callbacks = listeners.get(eventName);
  if (!callbacks) return;
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
