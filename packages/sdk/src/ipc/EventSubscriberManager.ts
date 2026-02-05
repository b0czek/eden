import type { EventData, EventName } from "@edenapp/types";
import { log } from "../logging";
import type { BackendManager } from "../process-manager/BackendManager";
import type { ViewManager } from "../view-manager/ViewManager";
import {
  getEventPermission,
  type PermissionRegistry,
} from "./PermissionRegistry";
export class EventSubscriberManager {
  private viewManager: ViewManager;
  private backendManager?: BackendManager;
  private subscriptions: Map<string, Set<number>> = new Map();
  private backendSubscriptions: Map<string, Set<string>> = new Map();
  private foundationSubscriptions: Map<string, boolean> = new Map();
  private internalSubscriptions: Map<string, Set<(payload: any) => void>> =
    new Map();
  private permissionRegistry?: PermissionRegistry;

  constructor(viewManager: ViewManager) {
    this.viewManager = viewManager;
  }

  /**
   * Set the backend manager for backend notifications
   */
  setBackendManager(backendManager: BackendManager): void {
    this.backendManager = backendManager;
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
      log.warn(`Cannot subscribe: view ${viewId} not found`);
      return false;
    }

    // Check event permission if required
    const requiredPermission = getEventPermission(eventName);
    if (requiredPermission && this.permissionRegistry) {
      if (
        !this.permissionRegistry.hasPermission(
          viewInfo.appId,
          requiredPermission,
        )
      ) {
        throw new Error(
          `Permission denied: ${requiredPermission} required to subscribe to ${eventName}`,
        );
      }
    }

    if (!this.subscriptions.has(eventName)) {
      this.subscriptions.set(eventName, new Set());
    }

    this.subscriptions.get(eventName)!.add(viewId);
    log.info(
      `View ${viewId} (${viewInfo.appId}) subscribed to event: ${eventName}`,
    );
    return true;
  }

  /**
   * Subscribe foundation to an event
   */
  public subscribeFoundation(eventName: string): boolean {
    if (!this.foundationSubscriptions.has(eventName)) {
      this.foundationSubscriptions.set(eventName, true);
      log.info(`Foundation subscribed to event: ${eventName}`);
    }
    return true;
  }

  /**
   * Subscribe a backend to an event
   */
  public subscribeBackend(appId: string, eventName: string): boolean {
    // Check event permission if required
    const requiredPermission = getEventPermission(eventName);
    if (requiredPermission && this.permissionRegistry) {
      if (!this.permissionRegistry.hasPermission(appId, requiredPermission)) {
        throw new Error(
          `Permission denied: ${requiredPermission} required to subscribe to ${eventName}`,
        );
      }
    }

    if (!this.backendSubscriptions.has(eventName)) {
      this.backendSubscriptions.set(eventName, new Set());
    }

    this.backendSubscriptions.get(eventName)!.add(appId);
    log.info(`Backend (${appId}) subscribed to event: ${eventName}`);
    return true;
  }

  /**
   * Subscribe an internal callback (for managers) to an event
   * Unlike view subscriptions, these are in-process callbacks
   */
  public subscribeInternal<T extends EventName>(
    event: T,
    callback: (data: EventData<T>) => void,
  ): void {
    if (!this.internalSubscriptions.has(event)) {
      this.internalSubscriptions.set(event, new Set());
    }
    this.internalSubscriptions
      .get(event)!
      .add(callback as (payload: any) => void);
    log.info(`Internal subscriber added for event: ${event}`);
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
      log.info(`View ${viewId} unsubscribed from event: ${eventName}`);
    }
    return result;
  }

  /**
   * Unsubscribe foundation from an event
   */
  public unsubscribeFoundation(eventName: string): boolean {
    if (this.foundationSubscriptions.has(eventName)) {
      this.foundationSubscriptions.delete(eventName);
      log.info(`Foundation unsubscribed from event: ${eventName}`);
      return true;
    }
    return false;
  }

  /**
   * Unsubscribe a backend from an event
   */
  public unsubscribeBackend(appId: string, eventName: string): boolean {
    const subscriptions = this.backendSubscriptions.get(eventName);
    if (!subscriptions) {
      return false;
    }

    const result = subscriptions.delete(appId);
    if (subscriptions.size === 0) {
      this.backendSubscriptions.delete(eventName);
    }

    if (result) {
      log.info(`Backend (${appId}) unsubscribed from event: ${eventName}`);
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
   * Get all backends subscribed to an event
   */
  public getSubscribedBackends(eventName: string): string[] {
    const subscriptions = this.backendSubscriptions.get(eventName);
    return subscriptions ? Array.from(subscriptions) : [];
  }

  /**
   * Send event only to subscribed views, backends, and internal callbacks
   */
  public notify(eventName: string, payload: any): void {
    // Notify internal subscribers first
    const internalCallbacks = this.internalSubscriptions.get(eventName);
    if (internalCallbacks) {
      for (const callback of internalCallbacks) {
        try {
          callback(payload);
        } catch (error) {
          log.error(`Error in internal subscriber for ${eventName}:`, error);
        }
      }
    }

    // Notify foundation if subscribed
    if (this.foundationSubscriptions.has(eventName)) {
      this.viewManager.sendToMainWindow("shell-message", {
        type: eventName,
        payload,
      });
    }

    // Notify view subscribers
    const subscribedViewIds = this.getSubscribedViews(eventName);
    for (const viewId of subscribedViewIds) {
      this.viewManager.sendToView(viewId, "shell-message", {
        type: eventName,
        payload,
      });
    }

    // Notify backend subscribers
    if (this.backendManager) {
      const subscribedBackends = this.getSubscribedBackends(eventName);
      for (const appId of subscribedBackends) {
        this.backendManager.sendMessage(appId, {
          type: "shell-event",
          eventName,
          payload,
        });
      }
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

  /**
   * Remove all subscriptions for a backend
   */
  public removeBackendSubscriptions(appId: string): void {
    for (const [
      eventName,
      subscribers,
    ] of this.backendSubscriptions.entries()) {
      if (subscribers.delete(appId)) {
        if (subscribers.size === 0) {
          this.backendSubscriptions.delete(eventName);
        }
      }
    }
  }
}
