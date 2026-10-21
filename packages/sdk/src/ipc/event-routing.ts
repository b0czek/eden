import type {
  EventData,
  EventName,
  OperationHandle,
  OperationObservation,
} from "@edenapp/types";
import type { ExecutionContext } from "../execution/context";
import type { RuntimeContexts } from "../execution/runtime-contexts";
import { log } from "../logging";
import type { Backends } from "../processes/backends";
import type { Views } from "../views/service";
import { EventPermissionDenied } from "./errors";
import type { EventScope } from "./event-scope";
import type { Permissions } from "./permissions";

export interface EventRouting {
  subscribe: (
    viewId: number,
    eventName: string,
    operation?: OperationObservation,
  ) => boolean;
  subscribeFoundation: (eventName: string) => boolean;
  subscribeBackend: (
    appId: string,
    eventName: string,
    operation?: OperationObservation,
  ) => boolean;
  unsubscribe: (
    viewId: number,
    eventName: string,
    operation?: OperationObservation,
  ) => boolean;
  unsubscribeFoundation: (eventName: string) => boolean;
  unsubscribeBackend: (
    appId: string,
    eventName: string,
    operation?: OperationObservation,
  ) => boolean;
  getSubscribedViews: (eventName: string) => number[];
  getSubscribedBackends: (eventName: string) => string[];
  hasSubscribers: (eventName: string, scope?: EventScope) => boolean;
  notify: <T extends EventName>(
    eventName: T,
    payload: EventData<T>,
    scope?: EventScope,
  ) => void;
  notifyView: <T extends EventName>(
    viewId: number,
    eventName: T,
    payload: EventData<T>,
  ) => boolean;
  removeViewSubscriptions: (viewId: number) => void;
  removeBackendSubscriptions: (appId: string) => void;
  dispose: () => void;
}

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

export function createEventRouting({
  views,
  execution,
  contexts,
  backends,
  permissions,
}: {
  views: Pick<Views, "getViewInfo" | "sendToView" | "sendToMainWindow">;
  execution: Pick<ExecutionContext, "get">;
  contexts: Pick<RuntimeContexts, "resolvePrincipal">;
  backends: Pick<Backends, "sendMessage">;
  permissions: Pick<Permissions, "getEventPermission" | "hasPermission">;
}): EventRouting {
  const subscriptions: Map<string, Set<number>> = new Map();
  const backendSubscriptions: Map<string, Set<string>> = new Map();
  const foundationSubscriptions: Map<string, boolean> = new Map();
  const operationViews: OperationSubscriptions<number> = new Map();
  const operationBackends: OperationSubscriptions<string> = new Map();
  const viewScopes = new Map<number, { appId?: string; sessionId?: string }>();
  const backendScopes = new Map<
    string,
    { appId?: string; sessionId?: string }
  >();

  function subscribe(
    viewId: number,
    eventName: string,
    operation?: OperationObservation,
  ): boolean {
    const viewInfo = views.getViewInfo(viewId);
    if (!viewInfo) {
      log.warn(`Cannot subscribe: view ${viewId} not found`);
      return false;
    }

    // Check event permission if required
    const requiredPermission = permissions?.getEventPermission(eventName);
    if (requiredPermission && permissions) {
      if (!permissions.hasPermission(viewInfo.appId, requiredPermission)) {
        throw new EventPermissionDenied({
          eventName,
          permission: requiredPermission,
          appId: viewInfo.appId,
        });
      }
    }

    if (operation) addOperation(operationViews, viewId, operation);
    else {
      let recipients = subscriptions.get(eventName);
      if (!recipients) {
        recipients = new Set();
        subscriptions.set(eventName, recipients);
      }
      recipients.add(viewId);
    }
    viewScopes.set(viewId, {
      appId: viewInfo.appId,
      sessionId: execution?.get()?.sessionId,
    });
    log.info(
      `View ${viewId} (${viewInfo.appId}) subscribed to event: ${eventName}`,
    );
    return true;
  }
  function subscribeFoundation(eventName: string): boolean {
    if (!foundationSubscriptions.has(eventName)) {
      foundationSubscriptions.set(eventName, true);
      log.info(`Foundation subscribed to event: ${eventName}`);
    }
    return true;
  }
  function subscribeBackend(
    appId: string,
    eventName: string,
    operation?: OperationObservation,
  ): boolean {
    // Check event permission if required
    const requiredPermission = permissions?.getEventPermission(eventName);
    if (requiredPermission && permissions) {
      if (!permissions.hasPermission(appId, requiredPermission)) {
        throw new EventPermissionDenied({
          eventName,
          permission: requiredPermission,
          appId,
        });
      }
    }

    if (operation) addOperation(operationBackends, appId, operation);
    else {
      let recipients = backendSubscriptions.get(eventName);
      if (!recipients) {
        recipients = new Set();
        backendSubscriptions.set(eventName, recipients);
      }
      recipients.add(appId);
    }
    backendScopes.set(appId, {
      appId,
      sessionId: execution?.get()?.sessionId,
    });
    log.info(`Backend (${appId}) subscribed to event: ${eventName}`);
    return true;
  }
  function unsubscribe(
    viewId: number,
    eventName: string,
    operation?: OperationObservation,
  ): boolean {
    if (operation) return removeOperation(operationViews, viewId, operation);
    const recipients = subscriptions.get(eventName);
    if (!recipients) {
      return false;
    }

    const result = recipients.delete(viewId);
    if (recipients.size === 0) {
      subscriptions.delete(eventName);
    }

    if (result) {
      log.info(`View ${viewId} unsubscribed from event: ${eventName}`);
    }
    return result;
  }
  function unsubscribeFoundation(eventName: string): boolean {
    if (foundationSubscriptions.has(eventName)) {
      foundationSubscriptions.delete(eventName);
      log.info(`Foundation unsubscribed from event: ${eventName}`);
      return true;
    }
    return false;
  }
  function unsubscribeBackend(
    appId: string,
    eventName: string,
    operation?: OperationObservation,
  ): boolean {
    if (operation) return removeOperation(operationBackends, appId, operation);
    const recipients = backendSubscriptions.get(eventName);
    if (!recipients) {
      return false;
    }

    const result = recipients.delete(appId);
    if (recipients.size === 0) {
      backendSubscriptions.delete(eventName);
    }

    if (result) {
      log.info(`Backend (${appId}) unsubscribed from event: ${eventName}`);
    }
    return result;
  }
  function getSubscribedViews(eventName: string): number[] {
    const recipients = subscriptions.get(eventName);
    return recipients ? Array.from(recipients) : [];
  }
  function getSubscribedBackends(eventName: string): string[] {
    const recipients = backendSubscriptions.get(eventName);
    return recipients ? Array.from(recipients) : [];
  }
  function* viewRecipients(
    eventName: string,
    scope?: EventScope,
  ): Iterable<number> {
    const general = subscriptions.get(eventName);
    if (general) for (const endpoint of general) yield endpoint;
    if (eventName === "operation/changed")
      for (const endpoint of interested(operationViews, scope?.operation))
        if (!general?.has(endpoint)) yield endpoint;
  }
  function* backendRecipients(
    eventName: string,
    scope?: EventScope,
  ): Iterable<string> {
    const general = backendSubscriptions.get(eventName);
    if (general) for (const endpoint of general) yield endpoint;
    if (eventName === "operation/changed")
      for (const endpoint of interested(operationBackends, scope?.operation))
        if (!general?.has(endpoint)) yield endpoint;
  }
  function viewAuthorized(viewId: number, scope?: EventScope): boolean {
    if (!scope) return true;
    const subscriber = viewScopes.get(viewId);
    return (
      subscriber?.appId !== undefined &&
      subscriber.appId === scope.appId &&
      subscriber.sessionId === scope.sessionId &&
      !!contexts.resolvePrincipal(subscriber.appId)
    );
  }
  function backendAuthorized(appId: string, scope?: EventScope): boolean {
    if (!scope) return true;
    const subscriber = backendScopes.get(appId);
    return (
      subscriber?.appId === scope.appId &&
      subscriber?.sessionId === scope.sessionId &&
      !!contexts?.resolvePrincipal(appId)
    );
  }
  function hasSubscribers(eventName: string, scope?: EventScope): boolean {
    if (!scope && foundationSubscriptions.has(eventName)) return true;
    for (const viewId of viewRecipients(eventName, scope))
      if (viewAuthorized(viewId, scope)) return true;
    if (backends)
      for (const appId of backendRecipients(eventName, scope))
        if (backendAuthorized(appId, scope)) return true;
    return false;
  }
  function notify<T extends EventName>(
    eventName: T,
    payload: EventData<T>,
    scope?: EventScope,
  ): void {
    // Notify foundation if subscribed
    if (!scope && foundationSubscriptions.has(eventName)) {
      views.sendToMainWindow("shell-message", {
        type: eventName,
        payload,
      });
    }

    // Notify view subscribers
    for (const viewId of viewRecipients(eventName, scope)) {
      if (!viewAuthorized(viewId, scope)) continue;
      views.sendToView(viewId, "shell-message", {
        type: eventName,
        payload,
      });
    }

    // Notify backend subscribers
    if (backends) {
      for (const appId of backendRecipients(eventName, scope)) {
        if (!backendAuthorized(appId, scope)) continue;
        backends.sendMessage(appId, {
          type: "shell-event",
          eventName,
          payload,
        });
      }
    }
  }
  function notifyView<T extends EventName>(
    viewId: number,
    eventName: T,
    payload: EventData<T>,
  ): boolean {
    const recipients = subscriptions.get(eventName);
    if (!recipients?.has(viewId)) {
      return false;
    }

    return views.sendToView(viewId, "shell-message", {
      type: eventName,
      payload,
    });
  }
  function removeViewSubscriptions(viewId: number): void {
    removeEndpoint(operationViews, viewId);
    viewScopes.delete(viewId);
    for (const [eventName, subscribers] of subscriptions.entries()) {
      if (subscribers.delete(viewId)) {
        if (subscribers.size === 0) {
          subscriptions.delete(eventName);
        }
      }
    }
  }
  function removeBackendSubscriptions(appId: string): void {
    removeEndpoint(operationBackends, appId);
    backendScopes.delete(appId);
    for (const [eventName, subscribers] of backendSubscriptions.entries()) {
      if (subscribers.delete(appId)) {
        if (subscribers.size === 0) {
          backendSubscriptions.delete(eventName);
        }
      }
    }
  }
  function dispose(): void {
    operationViews.clear();
    operationBackends.clear();
    viewScopes.clear();
    backendScopes.clear();
    subscriptions.clear();
    backendSubscriptions.clear();
    foundationSubscriptions.clear();
  }
  return {
    subscribe,
    subscribeFoundation,
    subscribeBackend,
    unsubscribe,
    unsubscribeFoundation,
    unsubscribeBackend,
    getSubscribedViews,
    getSubscribedBackends,
    hasSubscribers,
    notify,
    notifyView,
    removeViewSubscriptions,
    removeBackendSubscriptions,
    dispose,
  };
}
