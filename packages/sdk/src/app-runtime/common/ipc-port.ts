import { log } from "../../logging";
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

export interface IPCPortMessageEvent {
  data: PortMessage;
}

/**
 * Unified interface for both DOM MessagePort and Electron MessagePortMain
 */
export interface IPCPort {
  postMessage(message: PortMessage): void;
  on(event: "message", listener: (event: IPCPortMessageEvent) => void): void;
  on(event: "close", listener: () => void): void;
  off(event: "message", listener: (event: IPCPortMessageEvent) => void): void;
  off(event: "close", listener: () => void): void;
  start(): void;
  close(): void;
}

/**
 * Wrap a DOM MessagePort to conform to IPCPort interface
 */
export function wrapDOMPort(port: MessagePort): IPCPort {
  const messageListeners = new Map<
    (event: IPCPortMessageEvent) => void,
    (event: MessageEvent<PortMessage>) => void
  >();
  const closeListeners = new Set<() => void>();

  function on(
    event: "message",
    listener: (event: IPCPortMessageEvent) => void,
  ): void;
  function on(event: "close", listener: () => void): void;
  function on(
    event: "message" | "close",
    listener: ((event: IPCPortMessageEvent) => void) | (() => void),
  ): void {
    if (event === "message") {
      const messageListener = listener as (event: IPCPortMessageEvent) => void;
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
    listener: (event: IPCPortMessageEvent) => void,
  ): void;
  function off(event: "close", listener: () => void): void;
  function off(
    event: "message" | "close",
    listener: ((event: IPCPortMessageEvent) => void) | (() => void),
  ): void {
    if (event === "message") {
      const messageListener = listener as (event: IPCPortMessageEvent) => void;
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
      port.close();
      // Manually trigger close listeners as DOM MessagePort doesn't emit 'close'
      closeListeners.forEach((listener) => {
        try {
          listener();
        } catch (e) {
          log.error("Error in close listener:", e);
        }
      });
      closeListeners.clear();
    },
  };
}

/**
 * Wrap an Electron MessagePortMain to conform to IPCPort interface
 * (MessagePortMain already uses the EventEmitter pattern)
 */
export function wrapElectronPort(port: Electron.MessagePortMain): IPCPort {
  return port as unknown as IPCPort;
}
