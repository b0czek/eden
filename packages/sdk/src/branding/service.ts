import type { EdenBrandingConfig, EdenBrandingInfo } from "@edenapp/types";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { InvalidBrandingName } from "./errors";
import { BrandingAssets, BrandingConfig } from "./ports";

export interface Branding {
  getInfo: () => EdenBrandingInfo;
  getWindowIconPath: () => string | undefined;
  getWindowTitle: (configuredTitle?: string) => string;
}

export const Branding = Context.Service<"eden/Branding", Branding>(
  "eden/Branding",
);

/** Throws InvalidBrandingName before runtime startup when configuration is invalid. */
export function resolveBrandingName(branding?: EdenBrandingConfig): string {
  if (!branding) return "Eden";
  const name = branding.name?.trim();
  if (!name) throw new InvalidBrandingName({ configuredName: branding.name });
  return name;
}

export const BrandingLive = Layer.effect(
  Branding,
  Effect.gen(function* () {
    const branding = yield* BrandingConfig;
    const assets = yield* BrandingAssets;
    const name = yield* Effect.try({
      try: () => resolveBrandingName(branding),
      catch: (error) => {
        if (error instanceof InvalidBrandingName) return error;
        throw error;
      },
    });
    const info: EdenBrandingInfo = { name };
    let windowIconPath: string | undefined;
    if (branding) {
      info.logoDataUrl = yield* assets.logoDataUrl(branding.logoPath);
      windowIconPath = yield* assets.windowIconPath(branding.iconPath);
    }

    function getInfo(): EdenBrandingInfo {
      return { ...info };
    }

    function getWindowIconPath(): string | undefined {
      return windowIconPath;
    }

    function getWindowTitle(configuredTitle?: string): string {
      return configuredTitle || name;
    }

    return { getInfo, getWindowIconPath, getWindowTitle };
  }),
);
