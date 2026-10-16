import type { EdenPowerProvider } from "@edenapp/types";
import * as Effect from "effect/Effect";
import type { PowerHost, PowerShutdown } from "./ports";

const asError = (error: unknown) =>
  error instanceof Error ? error : new Error(String(error));

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
      Effect.tryPromise({
        try: async () => {
          await provider[action]!.call(provider);
        },
        catch: asError,
      }).pipe(Effect.uninterruptible),
  };
}

export function createPowerShutdown(manager: {
  shutdown(): Promise<void>;
}): PowerShutdown {
  return {
    shutdown: () =>
      Effect.tryPromise({
        try: () => manager.shutdown(),
        catch: asError,
      }).pipe(Effect.uninterruptible),
  };
}
