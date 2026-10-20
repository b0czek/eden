import type { EdenBrandingConfig } from "@edenapp/types";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export const BrandingConfig = Context.Service<
  "eden/BrandingConfig",
  EdenBrandingConfig | undefined
>("eden/BrandingConfig");

export interface BrandingAssets {
  logoDataUrl(configuredPath?: string): Effect.Effect<string | undefined>;
  windowIconPath(configuredPath?: string): Effect.Effect<string | undefined>;
}
export const BrandingAssets = Context.Service<
  "eden/BrandingAssets",
  BrandingAssets
>("eden/BrandingAssets");
