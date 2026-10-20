import * as Context from "effect/Context";
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
export const AppChannelTransport = Context.Service<
  "eden/AppChannelTransport",
  AppChannelTransport
>("eden/AppChannelTransport");

export interface AppChannelBackends {
  hasBackend(appId: string): boolean;
  sendPortToBackend(
    appId: string,
    message: unknown,
    ports: PlatformMessagePort[],
  ): boolean;
  sendMessage(appId: string, message: unknown): boolean;
}
export const AppChannelBackends = Context.Service<
  "eden/AppChannelBackends",
  AppChannelBackends
>("eden/AppChannelBackends");

/** Synchronous process teardown must remove registrations before views and backends. */
export interface AppChannelLifecycle {
  unregisterAllServices(appId: string): number;
}
export const AppChannelLifecycle = Context.Service<
  "eden/AppChannelLifecycle",
  AppChannelLifecycle
>("eden/AppChannelLifecycle");
