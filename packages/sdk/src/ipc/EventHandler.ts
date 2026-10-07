import { APP_EVENT_NAMES } from "../generated/runtime";
import type { OperationObservation } from "@edenapp/types";
import * as v from "valibot";
import type { OperationManager } from "../operations/OperationManager";
import type { ViewManager } from "../view-manager/ViewManager";
import { EdenHandler, EdenNamespace } from "./CommandDecorators";
import type { EventSubscriberManager } from "./EventSubscriberManager";
import { assertFoundationEventAllowed } from "./FoundationPolicy";

@EdenNamespace("event")
export class EventHandler {
  private subscriberManager: EventSubscriberManager;
  private viewManager: ViewManager;

  constructor(
    subscriberManager: EventSubscriberManager,
    viewManager: ViewManager,
    private operations: OperationManager,
  ) {
    this.subscriberManager = subscriberManager;
    this.viewManager = viewManager;
  }

  @EdenHandler("subscribe")
  subscribe(args: {
    eventName: string;
    operation?: OperationObservation;
    _callerWebContentsId?: number;
    _callerAppId?: string;
    _isFoundation?: boolean;
  }): void {
    const { eventName, _callerWebContentsId, _callerAppId, _isFoundation } =
      args;

    if (!APP_EVENT_NAMES.includes(eventName)) {
      throw new Error(`Event '${eventName}' is not supported`);
    }
    const operation = this.observation(eventName, args.operation);
    if (operation) this.operations.get(operation.handle);

    if (_isFoundation) {
      assertFoundationEventAllowed(eventName);
      this.subscriberManager.subscribeFoundation(eventName);
    } else if (_callerWebContentsId !== undefined) {
      // Request from a view
      const viewId =
        this.viewManager.getViewIdByWebContentsId(_callerWebContentsId);
      if (viewId === undefined) {
        throw new Error("View not found");
      }
      this.subscriberManager.subscribe(viewId, eventName, operation);
    } else if (_callerAppId) {
      // Request from a backend
      this.subscriberManager.subscribeBackend(
        _callerAppId,
        eventName,
        operation,
      );
    } else {
      throw new Error("Caller identity not found");
    }
  }

  @EdenHandler("unsubscribe")
  unsubscribe(args: {
    eventName: string;
    operation?: OperationObservation;
    _callerWebContentsId?: number;
    _callerAppId?: string;
    _isFoundation?: boolean;
  }): void {
    const { eventName, _callerWebContentsId, _callerAppId, _isFoundation } =
      args;
    const operation = this.observation(eventName, args.operation);

    if (_isFoundation) {
      assertFoundationEventAllowed(eventName);
      this.subscriberManager.unsubscribeFoundation(eventName);
    } else if (_callerWebContentsId !== undefined) {
      // Request from a view
      const viewId =
        this.viewManager.getViewIdByWebContentsId(_callerWebContentsId);
      if (viewId !== undefined) {
        this.subscriberManager.unsubscribe(viewId, eventName, operation);
      }
    } else if (_callerAppId) {
      // Request from a backend
      this.subscriberManager.unsubscribeBackend(
        _callerAppId,
        eventName,
        operation,
      );
    }
  }

  @EdenHandler("exists")
  exists(args: { eventName: string }): boolean {
    return APP_EVENT_NAMES.includes(args.eventName);
  }

  private observation(
    eventName: string,
    operation?: OperationObservation,
  ): OperationObservation | undefined {
    if (operation === undefined) return;
    if (eventName !== "operation/changed")
      throw new Error("Operation filters require operation/changed");
    return v.parse(
      v.object({
        handle: v.object({ command: v.string(), id: v.string() }),
        terminalOnly: v.optional(v.boolean()),
      }),
      operation,
    );
  }
}
