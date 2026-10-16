import type * as Effect from "effect/Effect";

export interface BrandingAssets {
  logoDataUrl(configuredPath?: string): Effect.Effect<string | undefined>;
  windowIconPath(configuredPath?: string): Effect.Effect<string | undefined>;
}
