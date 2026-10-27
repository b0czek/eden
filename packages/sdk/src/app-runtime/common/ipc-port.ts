import { log } from "../../platform/logging/logger";
/**
 * IPC Port - Unified interface for MessagePort communication
 *
 * Provides a common interface for both:
 * - DOM MessagePort (frontend/preload)
 * - Electron MessagePortMain (backend utility process)
 */

export type PortMessage =
  | { type: "message"; method: string; payload?: unknown }
  | { type: "request"; method: string; payload?: unknown; messageId: string }
  | { type: "response"; messageId: string; payload?: unknown; error?: string };

export interface IpcPortMessageEvent {
  data: PortMessage;
}

/**
 * Unified interface for both DOM MessagePort and Electron MessagePortMain
 */
export interface IpcPort {
  postMessage(message: PortMessage): void;
  on(event: "message", listener: (event: IpcPortMessageEvent) => void): void;
  on(event: "close", listener: () => void): void;
  off(event: "message", listener: (event: IpcPortMessageEvent) => void): void;
  off(event: "close", listener: () => void): void;
  start(): void;
  close(): void;
}

/**
 * Wrap a DOM MessagePort to conform to IpcPort interface
 */
export function wrapDOMPort(port: MessagePort): IpcPort {
  const messageListeners = new Map<
    (event: IpcPortMessageEvent) => void,
    (event: MessageEvent<PortMessage>) => void
  >();
  const closeListeners = new Set<() => void>();

  function notifyClosed() {
    port.removeEventListener("close", notifyClosed);
    for (const wrapper of messageListeners.values())
      port.removeEventListener("message", wrapper);
    messageListeners.clear();
    for (const listener of [...closeListeners]) {
      try {
        listener();
      } catch (error) {
        log.error("Error in close listener:", error);
      }
    }
    closeListeners.clear();
  }
  port.addEventListener("close", notifyClosed);

  function on(
    event: "message",
    listener: (event: IpcPortMessageEvent) => void,
  ): void;
  function on(event: "close", listener: () => void): void;
  function on(
    event: "message" | "close",
    listener: ((event: IpcPortMessageEvent) => void) | (() => void),
  ): void {
    if (event === "message") {
      const messageListener = listener as (event: IpcPortMessageEvent) => void;
      const wrapper = (messageEvent: MessageEvent<PortMessage>) =>
        messageListener({ data: messageEvent.data });
      messageListeners.set(messageListener, wrapper);
      port.addEventListener("message", wrapper);
      return;
    }

    closeListeners.add(listener as () => void);
  }

  function off(
    event: "message",
    listener: (event: IpcPortMessageEvent) => void,
  ): void;
  function off(event: "close", listener: () => void): void;
  function off(
    event: "message" | "close",
    listener: ((event: IpcPortMessageEvent) => void) | (() => void),
  ): void {
    if (event === "message") {
      const messageListener = listener as (event: IpcPortMessageEvent) => void;
      const wrapper = messageListeners.get(messageListener);
      if (wrapper) {
        port.removeEventListener("message", wrapper);
        messageListeners.delete(messageListener);
      }
      return;
    }

    closeListeners.delete(listener as () => void);
  }

  return {
    postMessage: (message: PortMessage) => port.postMessage(message),
    on,
    off,
    start: () => port.start(),
    close: () => {
      try {
        port.close();
      } finally {
        // Main-process close notifications also cover ports without native close events.
        notifyClosed();
      }
    },
  };
}

/**
 * Wrap an Electron MessagePortMain to conform to IpcPort interface
 * (MessagePortMain already uses the EventEmitter pattern)
 */
export function wrapElectronPort(port: Electron.MessagePortMain): IpcPort {
  return port as unknown as IpcPort;
}
