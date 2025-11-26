/**
 * Event Subscription Types
 * 
 * Defines types for the unified event subscription system that works
 * identically for apps and shell/overlays.
 */

export interface EventSubscription {
  viewId: number;
  eventName: string;
  subscribedAt: number;
}

export interface SubscriptionRegistry {
  // Map of eventName -> Set of viewIds
  [eventName: string]: Set<number>;
}

/**
 * Subscription IPC Events (internal, not part of AppEvents)
 */
export interface SubscriptionIPCEvents {
  "event/subscribe": { viewId: number; eventName: string };
  "event/unsubscribe": { viewId: number; eventName: string };
}
