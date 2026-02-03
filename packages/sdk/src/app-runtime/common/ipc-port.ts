import { log } from "../../logging";
/**
 * IPC Port - Unified interface for MessagePort communication
 *
 * Provides a common interface for both:
 * - DOM MessagePort (frontend/preload)
 * - Electron MessagePortMain (backend utility process)
 */

/**
 * Unified interface for both DOM MessagePort and Electron MessagePortMain
 */
export interface IPCPort {
  postMessage(message: any): void;
  on(event: "message", listener: (event: { data: any }) => void): void;
  on(event: "close", listener: () => void): void;
  off(event: "message", listener: (event: { data: any }) => void): void;
  off(event: "close", listener: () => void): void;
  start(): void;
  close(): void;
}

/**
 * Wrap a DOM MessagePort to conform to IPCPort interface
 */
export function wrapDOMPort(port: MessagePort): IPCPort {
  const messageListeners = new Map<
    (event: { data: any }) => void,
    (event: MessageEvent) => void
  >();
  const closeListeners = new Set<() => void>();

  return {
    postMessage: (message: any) => port.postMessage(message),

    on: ((event: string, listener: any) => {
      if (event === "message") {
        // Create a wrapper that extracts data from MessageEvent
        const wrapper = (e: MessageEvent) => listener({ data: e.data });
        messageListeners.set(listener, wrapper);
        port.addEventListener("message", wrapper);
      } else if (event === "close") {
        closeListeners.add(listener);
      }
    }) as IPCPort["on"],

    off: ((event: string, listener: any) => {
      if (event === "message") {
        const wrapper = messageListeners.get(listener);
        if (wrapper) {
          port.removeEventListener("message", wrapper);
          messageListeners.delete(listener);
        }
      } else if (event === "close") {
        closeListeners.delete(listener);
      }
    }) as IPCPort["off"],

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
