import { EdenNamespace, EdenHandler } from "./CommandDecorators";
import { EventSubscriberManager } from "./EventSubscriberManager";
import { APP_EVENT_NAMES } from "../generated/runtime";
import { ViewManager } from "../view-manager/ViewManager";

@EdenNamespace("event")
export class EventHandler {
  private subscriberManager: EventSubscriberManager;
  private viewManager: ViewManager;

  constructor(
    subscriberManager: EventSubscriberManager,
    viewManager: ViewManager,
  ) {
    this.subscriberManager = subscriberManager;
    this.viewManager = viewManager;
  }

  @EdenHandler("subscribe")
  subscribe(args: {
    eventName: string;
    _callerWebContentsId?: number;
    _callerAppId?: string;
    _isFoundation?: boolean;
  }): void {
    const { eventName, _callerWebContentsId, _callerAppId, _isFoundation } =
      args;

    if (!APP_EVENT_NAMES.includes(eventName as any)) {
      throw new Error(`Event '${eventName}' is not supported`);
    }

    if (_isFoundation) {
      this.subscriberManager.subscribeFoundation(eventName);
    } else if (_callerWebContentsId !== undefined) {
      // Request from a view
      const viewId =
        this.viewManager.getViewIdByWebContentsId(_callerWebContentsId);
      if (viewId === undefined) {
        throw new Error("View not found");
      }
      this.subscriberManager.subscribe(viewId, eventName);
    } else if (_callerAppId) {
      // Request from a backend
      this.subscriberManager.subscribeBackend(_callerAppId, eventName);
    } else {
      throw new Error("Caller identity not found");
    }
  }

  @EdenHandler("unsubscribe")
  unsubscribe(args: {
    eventName: string;
    _callerWebContentsId?: number;
    _callerAppId?: string;
    _isFoundation?: boolean;
  }): void {
    const { eventName, _callerWebContentsId, _callerAppId, _isFoundation } =
      args;

    if (_isFoundation) {
      this.subscriberManager.unsubscribeFoundation(eventName);
    } else if (_callerWebContentsId !== undefined) {
      // Request from a view
      const viewId =
        this.viewManager.getViewIdByWebContentsId(_callerWebContentsId);
      if (viewId !== undefined) {
        this.subscriberManager.unsubscribe(viewId, eventName);
      }
    } else if (_callerAppId) {
      // Request from a backend
      this.subscriberManager.unsubscribeBackend(_callerAppId, eventName);
    }
  }

  @EdenHandler("exists")
  exists(args: { eventName: string }): boolean {
    return APP_EVENT_NAMES.includes(args.eventName as any);
  }
}
