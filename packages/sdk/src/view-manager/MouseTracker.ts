import { screen } from "electron";

import { log } from "../logging";
/**
 * Callback function for mouse updates
 */
export type MouseUpdateCallback = (position: {
  x: number;
  y: number;
  deltaTime: number;
}) => void;

/**
 * MouseTracker
 *
 * Centralized mouse position tracker for Eden.
 * Provides a single efficient polling mechanism that multiple
 * operations (drag, resize, etc.) can subscribe to.
 */
export class MouseTracker {
  private subscribers: Map<string, MouseUpdateCallback> = new Map();
  private interval: NodeJS.Timeout | null = null;
  private lastUpdateTime: number = 0;
  private lastPosition: { x: number; y: number } = { x: 0, y: 0 };
  private readonly updateInterval: number;

  /**
   * @param updateInterval - Update interval in milliseconds (default: 8ms for ~120fps)
   */
  constructor(updateInterval: number = 8) {
    this.updateInterval = updateInterval;
  }

  /**
   * Subscribe to mouse position updates
   * @param id - Unique identifier for this subscriber
   * @param callback - Function to call with mouse updates
   */
  subscribe(id: string, callback: MouseUpdateCallback): void {
    // Add subscriber
    this.subscribers.set(id, callback);

    // Start tracking if this is the first subscriber
    if (this.subscribers.size === 1) {
      this.start();
    }
  }

  /**
   * Unsubscribe from mouse position updates
   * @param id - Unique identifier of the subscriber to remove
   */
  unsubscribe(id: string): void {
    this.subscribers.delete(id);

    // Stop tracking if no more subscribers
    if (this.subscribers.size === 0) {
      this.stop();
    }
  }

  /**
   * Get the current mouse position
   */
  getCurrentPosition(): { x: number; y: number } {
    return screen.getCursorScreenPoint();
  }

  /**
   * Check if currently tracking
   */
  isTracking(): boolean {
    return this.interval !== null;
  }

  /**
   * Get number of active subscribers
   */
  getSubscriberCount(): number {
    return this.subscribers.size;
  }

  /**
   * Start the mouse tracking interval
   */
  private start(): void {
    if (this.interval) return;

    this.lastUpdateTime = Date.now();
    this.lastPosition = this.getCurrentPosition();

    this.interval = setInterval(() => {
      const now = Date.now();
      const deltaTime = now - this.lastUpdateTime;
      this.lastUpdateTime = now;

      const currentPosition = this.getCurrentPosition();

      // Only emit if cursor has actually moved (skip unnecessary callbacks)
      if (
        Math.abs(currentPosition.x - this.lastPosition.x) < 1 &&
        Math.abs(currentPosition.y - this.lastPosition.y) < 1
      ) {
        return;
      }

      this.lastPosition = currentPosition;

      // Notify all subscribers of the position change
      for (const callback of this.subscribers.values()) {
        try {
          callback({ ...currentPosition, deltaTime });
        } catch (error) {
          log.error("Error in MouseTracker callback:", error);
        }
      }
    }, this.updateInterval);
  }

  /**
   * Stop the mouse tracking interval
   */
  private stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /**
   * Cleanup and stop tracking
   */
  dispose(): void {
    this.subscribers.clear();
    this.stop();
  }
}
