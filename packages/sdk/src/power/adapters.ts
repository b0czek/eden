import * as Effect from "effect/Effect";
import type { EdenPowerProvider } from "../api/config";
import type { PowerHost } from "./service";

export function createPowerHost(
  provider?: EdenPowerProvider,
): PowerHost | undefined {
  if (!provider) return undefined;
  return {
    getCapabilities: () => ({
      poweroff: typeof provider.poweroff === "function",
      reboot: typeof provider.reboot === "function",
    }),
    perform: (action) =>
      Effect.suspend(() => provider[action]!.call(provider)).pipe(
        Effect.uninterruptible,
      ),
  };
}
