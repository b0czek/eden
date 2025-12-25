import { ViewManager } from "../view-manager/ViewManager";
import { PermissionRegistry, getEventPermission } from "./PermissionRegistry";
import { EventName, EventData } from "@edenapp/types";

export class EventSubscriberManager {
  private viewManager: ViewManager;
  private subscriptions: Map<string, Set<number>> = new Map();
  private internalSubscriptions: Map<string, Set<(payload: any) => void>> =
    new Map();
  private permissionRegistry?: PermissionRegistry;

  constructor(viewManager: ViewManager) {
    this.viewManager = viewManager;
  }

  /**
   * Set the permission registry for permission checking
   */
  setPermissionRegistry(registry: PermissionRegistry): void {
    this.permissionRegistry = registry;
  }

  /**
   * Subscribe a view to an event
   */
  public subscribe(viewId: number, eventName: string): boolean {
    const viewInfo = this.viewManager.getViewInfo(viewId);
    if (!viewInfo) {
      console.warn(`Cannot subscribe: view ${viewId} not found`);
      return false;
    }

    // Check event permission if required
    const requiredPermission = getEventPermission(eventName);
    if (requiredPermission && this.permissionRegistry) {
      if (
        !this.permissionRegistry.hasPermission(
          viewInfo.appId,
          requiredPermission
        )
      ) {
        throw new Error(
          `Permission denied: ${requiredPermission} required to subscribe to ${eventName}`
        );
      }
    }

    if (!this.subscriptions.has(eventName)) {
      this.subscriptions.set(eventName, new Set());
    }

    this.subscriptions.get(eventName)!.add(viewId);
    console.log(
      `View ${viewId} (${viewInfo.appId}) subscribed to event: ${eventName}`
    );
    return true;
  }

  /**
   * Subscribe an internal callback (for managers) to an event
   * Unlike view subscriptions, these are in-process callbacks
   */
  public subscribeInternal<T extends EventName>(
    event: T,
    callback: (data: EventData<T>) => void
  ): void {
    if (!this.internalSubscriptions.has(event)) {
      this.internalSubscriptions.set(event, new Set());
    }
    this.internalSubscriptions
      .get(event)!
      .add(callback as (payload: any) => void);
    console.log(`Internal subscriber added for event: ${event}`);
  }

  /**
   * Unsubscribe a view from an event
   */
  public unsubscribe(viewId: number, eventName: string): boolean {
    const subscriptions = this.subscriptions.get(eventName);
    if (!subscriptions) {
      return false;
    }

    const result = subscriptions.delete(viewId);
    if (subscriptions.size === 0) {
      this.subscriptions.delete(eventName);
    }

    if (result) {
      console.log(`View ${viewId} unsubscribed from event: ${eventName}`);
    }
    return result;
  }

  /**
   * Get all views subscribed to an event
   */
  public getSubscribedViews(eventName: string): number[] {
    const subscriptions = this.subscriptions.get(eventName);
    return subscriptions ? Array.from(subscriptions) : [];
  }

  /**
   * Send event only to subscribed views and internal callbacks
   */
  public notify(eventName: string, payload: any): void {
    // Notify internal subscribers first
    const internalCallbacks = this.internalSubscriptions.get(eventName);
    if (internalCallbacks) {
      for (const callback of internalCallbacks) {
        try {
          callback(payload);
        } catch (error) {
          console.error(
            `Error in internal subscriber for ${eventName}:`,
            error
          );
        }
      }
    }

    // Notify view subscribers
    const subscribedViewIds = this.getSubscribedViews(eventName);
    for (const viewId of subscribedViewIds) {
      this.viewManager.sendToView(viewId, "shell-message", {
        type: eventName,
        payload,
      });
    }
  }

  /**
   * Send event to a specific subscribed view
   */
  public notifyView(viewId: number, eventName: string, payload: any): boolean {
    const subscriptions = this.subscriptions.get(eventName);
    if (!subscriptions || !subscriptions.has(viewId)) {
      return false;
    }

    return this.viewManager.sendToView(viewId, "shell-message", {
      type: eventName,
      payload,
    });
  }

  /**
   * Remove all subscriptions for a view
   */
  public removeViewSubscriptions(viewId: number): void {
    for (const [eventName, subscribers] of this.subscriptions.entries()) {
      if (subscribers.delete(viewId)) {
        if (subscribers.size === 0) {
          this.subscriptions.delete(eventName);
        }
      }
    }
  }
}
