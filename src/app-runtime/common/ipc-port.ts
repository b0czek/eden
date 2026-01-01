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
  off(event: "message", listener: (event: { data: any }) => void): void;
  start(): void;
  close(): void;
}

/**
 * Wrap a DOM MessagePort to conform to IPCPort interface
 */
export function wrapDOMPort(port: MessagePort): IPCPort {
  const listeners = new Map<
    (event: { data: any }) => void,
    (event: MessageEvent) => void
  >();

  return {
    postMessage: (message: any) => port.postMessage(message),
    on: (event: "message", listener: (event: { data: any }) => void) => {
      // Create a wrapper that extracts data from MessageEvent
      const wrapper = (e: MessageEvent) => listener({ data: e.data });
      listeners.set(listener, wrapper);
      port.addEventListener("message", wrapper);
    },
    off: (event: "message", listener: (event: { data: any }) => void) => {
      const wrapper = listeners.get(listener);
      if (wrapper) {
        port.removeEventListener("message", wrapper);
        listeners.delete(listener);
      }
    },
    start: () => port.start(),
    close: () => port.close(),
  };
}

/**
 * Wrap an Electron MessagePortMain to conform to IPCPort interface
 * (MessagePortMain already uses the EventEmitter pattern)
 */
export function wrapElectronPort(port: Electron.MessagePortMain): IPCPort {
  return port as unknown as IPCPort;
}
