import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as Effect from "effect/Effect";
import { log } from "../logging";
import type { BrandingAssets } from "./ports";

const LOGO_MIME_TYPES: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

const LOGO_EXTENSIONS = new Set(Object.keys(LOGO_MIME_TYPES));
const WINDOW_ICON_EXTENSIONS = new Set([".png", ".ico"]);

export function createFilesystemBrandingAssets(
  appPath: string,
): BrandingAssets {
  async function resolveAsset(
    configuredPath: string | undefined,
    label: string,
    supportedExtensions: Set<string>,
  ): Promise<string | undefined> {
    if (!configuredPath) return undefined;

    const resolvedPath = path.isAbsolute(configuredPath)
      ? path.normalize(configuredPath)
      : path.resolve(appPath, configuredPath);
    const extension = path.extname(resolvedPath).toLowerCase();

    if (!supportedExtensions.has(extension)) {
      log.warn(
        `Ignoring branding ${label} with unsupported extension "${extension || "(none)"}": ${resolvedPath}`,
      );
      return undefined;
    }

    try {
      if (!(await fs.stat(resolvedPath)).isFile()) {
        log.warn(
          `Ignoring branding ${label} that is not a file: ${resolvedPath}`,
        );
        return undefined;
      }
    } catch (error) {
      log.warn(`Failed to access branding ${label} at ${resolvedPath}:`, error);
      return undefined;
    }

    return resolvedPath;
  }

  return {
    logoDataUrl: (configuredPath) =>
      Effect.promise(async () => {
        const logoPath = await resolveAsset(
          configuredPath,
          "logo",
          LOGO_EXTENSIONS,
        );
        if (!logoPath) return undefined;

        try {
          const extension = path.extname(logoPath).toLowerCase();
          const contents = await fs.readFile(logoPath);
          return `data:${LOGO_MIME_TYPES[extension]};base64,${contents.toString("base64")}`;
        } catch (error) {
          log.warn(`Failed to read branding logo at ${logoPath}:`, error);
          return undefined;
        }
      }),
    windowIconPath: (configuredPath) =>
      Effect.promise(() =>
        resolveAsset(configuredPath, "window icon", WINDOW_ICON_EXTENSIONS),
      ),
  };
}
