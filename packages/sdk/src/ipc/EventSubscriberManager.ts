import type { EventData, EventName } from "@edenapp/types";
import type { ExecutionContext } from "../execution/ExecutionContext";
import type { RuntimeContextRegistry } from "../execution/RuntimeContextRegistry";
import { log } from "../logging";
import type { BackendManager } from "../process-manager/BackendManager";
import type { ViewManager } from "../view-manager/ViewManager";
import type { PermissionRegistry } from "./PermissionRegistry";
export class EventSubscriberManager {
  private viewManager: ViewManager;
  private backendManager?: BackendManager;
  private subscriptions: Map<string, Set<number>> = new Map();
  private backendSubscriptions: Map<string, Set<string>> = new Map();
  private foundationSubscriptions: Map<string, boolean> = new Map();
  private permissionRegistry?: PermissionRegistry;

  private viewScopes = new Map<
    number,
    { appId?: string; sessionId?: string }
  >();
  private backendScopes = new Map<
    string,
    { appId?: string; sessionId?: string }
  >();

  constructor(
    viewManager: ViewManager,
    private execution?: ExecutionContext,
    private contexts?: RuntimeContextRegistry,
  ) {
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
    const requiredPermission =
      this.permissionRegistry?.getEventPermission(eventName);
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

    this.subscriptions.get(eventName)?.add(viewId);
    this.viewScopes.set(viewId, {
      appId: viewInfo.appId,
      sessionId: this.execution?.get()?.sessionId,
    });
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
    const requiredPermission =
      this.permissionRegistry?.getEventPermission(eventName);
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

    this.backendSubscriptions.get(eventName)?.add(appId);
    this.backendScopes.set(appId, {
      appId,
      sessionId: this.execution?.get()?.sessionId,
    });
    log.info(`Backend (${appId}) subscribed to event: ${eventName}`);
    return true;
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

  /** Send an event to subscribed external consumers. */
  public notify<T extends EventName>(
    eventName: T,
    payload: EventData<T>,
    scope?: { appId?: string; sessionId: string },
  ): void {
    // Notify foundation if subscribed
    if (!scope && this.foundationSubscriptions.has(eventName)) {
      this.viewManager.sendToMainWindow("shell-message", {
        type: eventName,
        payload,
      });
    }

    // Notify view subscribers
    const subscribedViewIds = this.getSubscribedViews(eventName);
    for (const viewId of subscribedViewIds) {
      const subscriber = this.viewScopes.get(viewId);
      if (
        scope &&
        (subscriber?.appId !== scope.appId ||
          subscriber?.sessionId !== scope.sessionId ||
          !this.contexts?.resolvePrincipal(subscriber.appId!))
      )
        continue;
      this.viewManager.sendToView(viewId, "shell-message", {
        type: eventName,
        payload,
      });
    }

    // Notify backend subscribers
    if (this.backendManager) {
      const subscribedBackends = this.getSubscribedBackends(eventName);
      for (const appId of subscribedBackends) {
        const subscriber = this.backendScopes.get(appId);
        if (
          scope &&
          (subscriber?.appId !== scope.appId ||
            subscriber?.sessionId !== scope.sessionId ||
            !this.contexts?.resolvePrincipal(appId))
        )
          continue;
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
  public notifyView<T extends EventName>(
    viewId: number,
    eventName: T,
    payload: EventData<T>,
  ): boolean {
    const subscriptions = this.subscriptions.get(eventName);
    if (!subscriptions?.has(viewId)) {
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
    this.viewScopes.delete(viewId);
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
    this.backendScopes.delete(appId);
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

  dispose(): void {
    this.viewScopes.clear();
    this.backendScopes.clear();
    this.subscriptions.clear();
    this.backendSubscriptions.clear();
    this.foundationSubscriptions.clear();
    this.backendManager = undefined;
    this.permissionRegistry = undefined;
  }
}
