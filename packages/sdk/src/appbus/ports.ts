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
