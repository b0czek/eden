import type { EdenBrandingConfig, EdenBrandingInfo } from "@edenapp/types";
import * as Effect from "effect/Effect";
import type { BrandingAssets } from "./ports";

interface BrandingDependencies {
  branding?: EdenBrandingConfig;
  assets: BrandingAssets;
}

export function resolveBrandingName(branding?: EdenBrandingConfig): string {
  if (!branding) return "Eden";
  const name = branding.name?.trim();
  if (!name) throw new Error("branding.name must be a non-empty string");
  return name;
}

export function createBranding({ branding, assets }: BrandingDependencies) {
  return Effect.gen(function* () {
    const name = yield* Effect.try({
      try: () => resolveBrandingName(branding),
      catch: (error) =>
        error instanceof Error ? error : new Error(String(error)),
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
  });
}

export type Branding = Effect.Success<ReturnType<typeof createBranding>>;
