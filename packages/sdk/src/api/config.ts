import type { EdenConfig as DesktopConfig } from "@edenapp/types";
import type * as Effect from "effect/Effect";

/** Trusted main-process power integration. */
export interface EdenPowerProvider {
  poweroff?: () => Effect.Effect<void, Error>;
  reboot?: () => Effect.Effect<void, Error>;
}

export interface EdenConfig extends DesktopConfig {
  /** Power actions are unavailable when omitted. */
  powerProvider?: EdenPowerProvider;
}
