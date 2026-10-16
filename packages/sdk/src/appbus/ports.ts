import type {
  PlatformMessagePort,
  PlatformWebContents,
} from "../platform/ports";

export interface AppChannelTransport {
  createMessageChannel(): {
    port1: PlatformMessagePort;
    port2: PlatformMessagePort;
  };
  getWebContentsById(
    id: number,
  ):
    | Pick<PlatformWebContents, "postMessage" | "send" | "isDestroyed">
    | undefined;
}

export interface AppChannelBackends {
  hasBackend(appId: string): boolean;
  sendPortToBackend(
    appId: string,
    message: unknown,
    ports: PlatformMessagePort[],
  ): boolean;
  sendMessage(appId: string, message: unknown): boolean;
}

/** Synchronous process teardown must remove registrations before views and backends. */
export interface AppChannelLifecycle {
  unregisterAllServices(appId: string): number;
}
