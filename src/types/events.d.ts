/**
 * AppEvents - Events sent from backend to renderer
 * 
 * All events are sent via the unified 'shell-message' channel.
 * Views must subscribe to specific events to receive them.
 * 
 * This file re-exports auto-generated event types.
 * Event definitions are automatically generated from @EdenNamespace decorators.
 * Run 'npm run codegen' to regenerate.
 */

export * from "./events.generated";

/**
 * Utility types for working with AppEvents
 */
export type EventName = (typeof import("./events.generated").APP_EVENT_NAMES)[number];
export type EventData<T extends EventName> = import("./events.generated").AppEvents[T];
