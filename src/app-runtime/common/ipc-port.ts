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
 * Adapts a DOM MessagePort to the IPCPort shape used by the application.
 *
 * The returned object forwards posted messages to the underlying MessagePort and
 * exposes `on`/`off` for `"message"` and `"close"`, `start`, and `close` methods.
 * Message listeners receive an object of the form `{ data }` (extracted from the
 * MessageEvent). Registered `"close"` listeners are invoked when the adapter's
 * `close()` is called.
 *
 * @param port - The DOM MessagePort to wrap
 * @returns An IPCPort that proxies messages and lifecycle events to the provided port
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
          console.error("[IPCPort] Error in close listener:", e);
        }
      });
      closeListeners.clear();
    },
  };
}

/**
 * Adapts an Electron MessagePortMain to the IPCPort interface.
 *
 * @param port - Electron MessagePortMain to adapt
 * @returns The provided port presented as an `IPCPort`
 */
export function wrapElectronPort(port: Electron.MessagePortMain): IPCPort {
  return port as unknown as IPCPort;
}