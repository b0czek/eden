import * as Effect from "effect/Effect";
import type { EdenPowerProvider } from "../../api/config";
import { PowerUnavailable } from "./errors";
import type { PowerHost } from "./ports";

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
      Effect.suspend(() => {
        const perform = provider[action];
        return perform
          ? perform.call(provider)
          : Effect.fail(new PowerUnavailable({ action, reason: "action" }));
      }).pipe(Effect.uninterruptible),
  };
}
