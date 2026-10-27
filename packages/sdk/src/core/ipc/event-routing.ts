import type {
  EventData,
  EventName,
  OperationHandle,
  OperationObservation,
} from "@edenapp/types";
import type { Backends } from "../../applications/processes/backends";
import type { Views } from "../../desktop/views/service";
import { log } from "../../platform/logging/logger";
import type {
  CommandCallerContext,
  ExecutionContext,
} from "../execution/context";
import type { RuntimeContexts } from "../execution/runtime-contexts";
import { EventPermissionDenied } from "./errors";
import type { EventScope } from "./event-scope";
import type { Permissions } from "./permissions";

type EventAuthorization = (recipient: CommandCallerContext) => boolean;

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
    authorize?: EventAuthorization,
  ) => void;
  notifyView: <T extends EventName>(
    viewId: number,
    eventName: T,
    payload: EventData<T>,
    authorize?: EventAuthorization,
  ) => boolean;
  removeViewSubscriptions: (viewId: number) => void;
  removeBackendSubscriptions: (appId: string) => void;
  dispose: () => void;
}

// View IDs are numbers; backend app IDs are strings.
type Endpoint = number | string;
type OperationSubscriptions = Map<string, Map<Endpoint, Set<boolean>>>;
const operationKey = (handle: OperationHandle) =>
  JSON.stringify([handle.command, handle.id]);

function addOperation(
  subscriptions: OperationSubscriptions,
  endpoint: Endpoint,
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

function removeOperation(
  subscriptions: OperationSubscriptions,
  endpoint: Endpoint,
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

function* interested(
  subscriptions: OperationSubscriptions,
  operation?: EventScope["operation"],
): Iterable<Endpoint> {
  if (!operation) return;
  const endpoints = subscriptions.get(operationKey(operation.handle));
  if (!endpoints) return;
  for (const [endpoint, interests] of endpoints)
    if (interests.has(false) || (operation.terminal && interests.has(true)))
      yield endpoint;
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
  const subscriptions = new Map<string, Set<Endpoint>>();
  const operations: OperationSubscriptions = new Map();
  const recipients = new Map<Endpoint, { appId: string; sessionId?: string }>();
  const foundationSubscriptions = new Set<string>();

  function subscribe(
    endpoint: Endpoint,
    appId: string,
    eventName: string,
    operation?: OperationObservation,
  ): boolean {
    const requiredPermission = permissions.getEventPermission(eventName);
    if (
      requiredPermission &&
      !permissions.hasPermission(appId, requiredPermission)
    ) {
      throw new EventPermissionDenied({
        eventName,
        permission: requiredPermission,
        appId,
      });
    }

    if (operation) addOperation(operations, endpoint, operation);
    else {
      let subscribers = subscriptions.get(eventName);
      if (!subscribers) {
        subscribers = new Set();
        subscriptions.set(eventName, subscribers);
      }
      subscribers.add(endpoint);
    }
    recipients.set(endpoint, { appId, sessionId: execution.get()?.sessionId });
    log.info(
      `${typeof endpoint === "number" ? "View" : "Backend"} ${endpoint} subscribed to event: ${eventName}`,
    );
    return true;
  }

  function unsubscribe(
    endpoint: Endpoint,
    eventName: string,
    operation?: OperationObservation,
  ): boolean {
    if (operation) return removeOperation(operations, endpoint, operation);
    const subscribers = subscriptions.get(eventName);
    const removed = subscribers?.delete(endpoint) ?? false;
    if (!subscribers?.size) subscriptions.delete(eventName);
    if (removed)
      log.info(
        `${typeof endpoint === "number" ? "View" : "Backend"} ${endpoint} unsubscribed from event: ${eventName}`,
      );
    return removed;
  }

  function* subscribers(
    eventName: string,
    scope?: EventScope,
  ): Iterable<Endpoint> {
    const general = subscriptions.get(eventName);
    if (general) yield* general;
    if (eventName === "operation/changed") {
      for (const endpoint of interested(operations, scope?.operation)) {
        if (!general?.has(endpoint)) yield endpoint;
      }
    }
  }

  function authorized(
    endpoint: Endpoint,
    scope?: EventScope,
    authorize?: EventAuthorization,
  ): boolean {
    if (!scope && !authorize) return true;
    const recipient = recipients.get(endpoint);
    if (!recipient) return false;
    if (
      scope &&
      (recipient.appId !== scope.appId ||
        recipient.sessionId !== scope.sessionId)
    )
      return false;
    const principal = contexts.resolvePrincipal(recipient.appId);
    return (
      !!principal && (!authorize || authorize({ ...recipient, principal }))
    );
  }

  function hasSubscribers(eventName: string, scope?: EventScope): boolean {
    if (!scope && foundationSubscriptions.has(eventName)) return true;
    for (const endpoint of subscribers(eventName, scope)) {
      if (authorized(endpoint, scope)) return true;
    }
    return false;
  }

  function notify<T extends EventName>(
    eventName: T,
    payload: EventData<T>,
    scope?: EventScope,
    authorize?: EventAuthorization,
  ): void {
    if (!scope && foundationSubscriptions.has(eventName) && !authorize) {
      views.sendToMainWindow("shell-message", { type: eventName, payload });
    }
    for (const endpoint of subscribers(eventName, scope)) {
      if (!authorized(endpoint, scope, authorize)) continue;
      if (typeof endpoint === "number") {
        views.sendToView(endpoint, "shell-message", {
          type: eventName,
          payload,
        });
      } else {
        backends.sendMessage(endpoint, {
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
    authorize?: EventAuthorization,
  ): boolean {
    if (
      !subscriptions.get(eventName)?.has(viewId) ||
      !authorized(viewId, undefined, authorize)
    )
      return false;
    return views.sendToView(viewId, "shell-message", {
      type: eventName,
      payload,
    });
  }

  function removeSubscriptions(endpoint: Endpoint): void {
    recipients.delete(endpoint);
    for (const [eventName, subscribers] of subscriptions) {
      subscribers.delete(endpoint);
      if (!subscribers.size) subscriptions.delete(eventName);
    }
    for (const [key, subscribers] of operations) {
      subscribers.delete(endpoint);
      if (!subscribers.size) operations.delete(key);
    }
  }

  return {
    subscribe(viewId, eventName, operation) {
      const view = views.getViewInfo(viewId);
      if (!view) {
        log.warn(`Cannot subscribe: view ${viewId} not found`);
        return false;
      }
      return subscribe(viewId, view.appId, eventName, operation);
    },
    subscribeBackend: (appId, eventName, operation) =>
      subscribe(appId, appId, eventName, operation),
    subscribeFoundation(eventName) {
      if (!foundationSubscriptions.has(eventName)) {
        foundationSubscriptions.add(eventName);
        log.info(`Foundation subscribed to event: ${eventName}`);
      }
      return true;
    },
    unsubscribe,
    unsubscribeBackend: unsubscribe,
    unsubscribeFoundation(eventName) {
      const removed = foundationSubscriptions.delete(eventName);
      if (removed) log.info(`Foundation unsubscribed from event: ${eventName}`);
      return removed;
    },
    getSubscribedViews: (eventName) =>
      Array.from(subscriptions.get(eventName) ?? []).filter(
        (endpoint) => typeof endpoint === "number",
      ),
    getSubscribedBackends: (eventName) =>
      Array.from(subscriptions.get(eventName) ?? []).filter(
        (endpoint) => typeof endpoint === "string",
      ),
    hasSubscribers,
    notify,
    notifyView,
    removeViewSubscriptions: removeSubscriptions,
    removeBackendSubscriptions: removeSubscriptions,
    dispose() {
      subscriptions.clear();
      operations.clear();
      recipients.clear();
      foundationSubscriptions.clear();
    },
  };
}
