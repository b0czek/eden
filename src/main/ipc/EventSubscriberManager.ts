import { ViewManager } from "../view-manager/ViewManager";

export class EventSubscriberManager {
  private viewManager: ViewManager;
  private subscriptions: Map<string, Set<number>> = new Map();

  constructor(viewManager: ViewManager) {
    this.viewManager = viewManager;
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

    if (!this.subscriptions.has(eventName)) {
      this.subscriptions.set(eventName, new Set());
    }
    
    this.subscriptions.get(eventName)!.add(viewId);
    console.log(`View ${viewId} (${viewInfo.appId}) subscribed to event: ${eventName}`);
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
   * Send event only to subscribed views
   */
  public notify(eventName: string, payload: any): void {
    const subscribedViewIds = this.getSubscribedViews(eventName);
    
    if (subscribedViewIds.length === 0) {
      // console.log(`No subscribers for event: ${eventName}`);
      return;
    }

    console.log(`Emitting ${eventName} to ${subscribedViewIds.length} subscribed view(s)`);
    
    for (const viewId of subscribedViewIds) {
      this.viewManager.sendToView(viewId, 'shell-message', {
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

    // console.log(`Emitting ${eventName} to specific view ${viewId}`);
    return this.viewManager.sendToView(viewId, 'shell-message', {
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
