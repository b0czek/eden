import type {
  EventData,
  EventName,
  OperationHandle,
  OperationObservation,
} from "@edenapp/types";
import type { ExecutionContext } from "../execution/ExecutionContext";
import type { RuntimeContextRegistry } from "../execution/RuntimeContextRegistry";
import { log } from "../logging";
import type { BackendManager } from "../process-manager/BackendManager";
import type { ViewManager } from "../view-manager/ViewManager";
import type { EventScope } from "./EventScope";
import type { PermissionRegistry } from "./PermissionRegistry";

type OperationSubscriptions<T> = Map<string, Map<T, Set<boolean>>>;
const operationKey = (handle: OperationHandle) =>
  JSON.stringify([handle.command, handle.id]);

function addOperation<T>(
  subscriptions: OperationSubscriptions<T>,
  endpoint: T,
  observation: OperationObservation,
): void {
  const key = operationKey(observation.handle);
  let endpoints = subscriptions.get(key);
  if (!endpoints) {
    endpoints = new Map();
    subscriptions.set(key, endpoints);
  }
  let interests = endpoints.get(endpoint);
  if (!interests) {
    interests = new Set();
    endpoints.set(endpoint, interests);
  }
  interests.add(observation.terminalOnly === true);
}

function removeOperation<T>(
  subscriptions: OperationSubscriptions<T>,
  endpoint: T,
  observation: OperationObservation,
): boolean {
  const key = operationKey(observation.handle);
  const endpoints = subscriptions.get(key);
  const interests = endpoints?.get(endpoint);
  const removed = interests?.delete(observation.terminalOnly === true) ?? false;
  if (!interests?.size) endpoints?.delete(endpoint);
  if (!endpoints?.size) subscriptions.delete(key);
  return removed;
}

function* interested<T>(
  subscriptions: OperationSubscriptions<T>,
  operation?: EventScope["operation"],
): Iterable<T> {
  if (!operation) return;
  const endpoints = subscriptions.get(operationKey(operation.handle));
  if (!endpoints) return;
  for (const [endpoint, interests] of endpoints)
    if (interests.has(false) || (operation.terminal && interests.has(true)))
      yield endpoint;
}

function removeEndpoint<T>(
  subscriptions: OperationSubscriptions<T>,
  endpoint: T,
): void {
  for (const [key, endpoints] of subscriptions) {
    endpoints.delete(endpoint);
    if (!endpoints.size) subscriptions.delete(key);
  }
}
export class EventSubscriberManager {
  private viewManager: ViewManager;
  private backendManager?: BackendManager;
  private subscriptions: Map<string, Set<number>> = new Map();
  private backendSubscriptions: Map<string, Set<string>> = new Map();
  private foundationSubscriptions: Map<string, boolean> = new Map();
  private permissionRegistry?: PermissionRegistry;
  private readonly operationViews: OperationSubscriptions<number> = new Map();
  private readonly operationBackends: OperationSubscriptions<string> =
    new Map();

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
  public subscribe(
    viewId: number,
    eventName: string,
    operation?: OperationObservation,
  ): boolean {
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

    if (operation) addOperation(this.operationViews, viewId, operation);
    else {
      if (!this.subscriptions.has(eventName))
        this.subscriptions.set(eventName, new Set());
      this.subscriptions.get(eventName)!.add(viewId);
    }
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
  public subscribeBackend(
    appId: string,
    eventName: string,
    operation?: OperationObservation,
  ): boolean {
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

    if (operation) addOperation(this.operationBackends, appId, operation);
    else {
      if (!this.backendSubscriptions.has(eventName))
        this.backendSubscriptions.set(eventName, new Set());
      this.backendSubscriptions.get(eventName)!.add(appId);
    }
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
  public unsubscribe(
    viewId: number,
    eventName: string,
    operation?: OperationObservation,
  ): boolean {
    if (operation)
      return removeOperation(this.operationViews, viewId, operation);
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
  public unsubscribeBackend(
    appId: string,
    eventName: string,
    operation?: OperationObservation,
  ): boolean {
    if (operation)
      return removeOperation(this.operationBackends, appId, operation);
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

  private *viewRecipients(
    eventName: string,
    scope?: EventScope,
  ): Iterable<number> {
    const general = this.subscriptions.get(eventName);
    if (general) for (const endpoint of general) yield endpoint;
    if (eventName === "operation/changed")
      for (const endpoint of interested(this.operationViews, scope?.operation))
        if (!general?.has(endpoint)) yield endpoint;
  }

  private *backendRecipients(
    eventName: string,
    scope?: EventScope,
  ): Iterable<string> {
    const general = this.backendSubscriptions.get(eventName);
    if (general) for (const endpoint of general) yield endpoint;
    if (eventName === "operation/changed")
      for (const endpoint of interested(
        this.operationBackends,
        scope?.operation,
      ))
        if (!general?.has(endpoint)) yield endpoint;
  }

  private viewAuthorized(viewId: number, scope?: EventScope): boolean {
    if (!scope) return true;
    const subscriber = this.viewScopes.get(viewId);
    return (
      subscriber?.appId === scope.appId &&
      subscriber?.sessionId === scope.sessionId &&
      !!this.contexts?.resolvePrincipal(subscriber.appId!)
    );
  }

  private backendAuthorized(appId: string, scope?: EventScope): boolean {
    if (!scope) return true;
    const subscriber = this.backendScopes.get(appId);
    return (
      subscriber?.appId === scope.appId &&
      subscriber?.sessionId === scope.sessionId &&
      !!this.contexts?.resolvePrincipal(appId)
    );
  }

  /** Check interest before a producer allocates a notification payload. */
  public hasSubscribers(eventName: string, scope?: EventScope): boolean {
    if (!scope && this.foundationSubscriptions.has(eventName)) return true;
    for (const viewId of this.viewRecipients(eventName, scope))
      if (this.viewAuthorized(viewId, scope)) return true;
    if (this.backendManager)
      for (const appId of this.backendRecipients(eventName, scope))
        if (this.backendAuthorized(appId, scope)) return true;
    return false;
  }

  /** Send an event once to each authorized, interested external consumer. */
  public notify<T extends EventName>(
    eventName: T,
    payload: EventData<T>,
    scope?: EventScope,
  ): void {
    // Notify foundation if subscribed
    if (!scope && this.foundationSubscriptions.has(eventName)) {
      this.viewManager.sendToMainWindow("shell-message", {
        type: eventName,
        payload,
      });
    }

    // Notify view subscribers
    for (const viewId of this.viewRecipients(eventName, scope)) {
      if (!this.viewAuthorized(viewId, scope)) continue;
      this.viewManager.sendToView(viewId, "shell-message", {
        type: eventName,
        payload,
      });
    }

    // Notify backend subscribers
    if (this.backendManager) {
      for (const appId of this.backendRecipients(eventName, scope)) {
        if (!this.backendAuthorized(appId, scope)) continue;
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
    removeEndpoint(this.operationViews, viewId);
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
    removeEndpoint(this.operationBackends, appId);
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
    this.operationViews.clear();
    this.operationBackends.clear();
    this.viewScopes.clear();
    this.backendScopes.clear();
    this.subscriptions.clear();
    this.backendSubscriptions.clear();
    this.foundationSubscriptions.clear();
    this.backendManager = undefined;
    this.permissionRegistry = undefined;
  }
}
