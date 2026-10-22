import * as path from "node:path";
import * as Effect from "effect/Effect";
import { io } from "../../platform/filesystem/native-io";
import { log } from "../../platform/logging/logger";
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
  const resolveAsset = Effect.fn(function* (
    configuredPath: string | undefined,
    label: string,
    supportedExtensions: Set<string>,
  ) {
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

    const stat = yield* io.stat(resolvedPath).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          log.warn(
            `Failed to access branding ${label} at ${resolvedPath}:`,
            error,
          );
          return undefined;
        }),
      ),
    );
    if (!stat) return undefined;
    if (!stat.isFile()) {
      log.warn(
        `Ignoring branding ${label} that is not a file: ${resolvedPath}`,
      );
      return undefined;
    }

    return resolvedPath;
  });

  const logoDataUrl = Effect.fn(function* (configuredPath: string | undefined) {
    const logoPath = yield* resolveAsset(
      configuredPath,
      "logo",
      LOGO_EXTENSIONS,
    );
    if (!logoPath) return undefined;
    return yield* io.readFile(logoPath).pipe(
      Effect.map(
        (contents) =>
          `data:${LOGO_MIME_TYPES[path.extname(logoPath).toLowerCase()]};base64,${contents.toString("base64")}`,
      ),
      Effect.catch((error) =>
        Effect.sync(() => {
          log.warn(`Failed to read branding logo at ${logoPath}:`, error);
          return undefined;
        }),
      ),
    );
  });
  return {
    logoDataUrl,
    windowIconPath: (configuredPath) =>
      resolveAsset(configuredPath, "window icon", WINDOW_ICON_EXTENSIONS),
  };
}
