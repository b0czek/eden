import * as fs from "node:fs";
import * as path from "node:path";
import type { EdenBrandingInfo, EdenConfig } from "@edenapp/types";
import { inject, injectable, singleton } from "tsyringe";
import { log } from "../logging";

const DEFAULT_PRODUCT_NAME = "Eden";

const LOGO_MIME_TYPES: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

const WINDOW_ICON_EXTENSIONS = new Set([".png", ".ico"]);

@singleton()
@injectable()
export class BrandingManager {
  private readonly info: EdenBrandingInfo;
  private readonly windowIconPath?: string;

  constructor(
    @inject("EdenConfig") config: EdenConfig,
    @inject("appPath") appPath: string,
  ) {
    const branding = config.branding;
    if (!branding) {
      this.info = { name: DEFAULT_PRODUCT_NAME };
      return;
    }

    const name = branding.name?.trim();
    if (!name) {
      throw new Error("branding.name must be a non-empty string");
    }

    this.info = {
      name,
      logoDataUrl: this.loadLogo(branding.logoPath, appPath),
    };
    this.windowIconPath = this.resolveAsset(
      branding.iconPath,
      appPath,
      "window icon",
      WINDOW_ICON_EXTENSIONS,
    );
  }

  getInfo(): EdenBrandingInfo {
    return { ...this.info };
  }

  getWindowIconPath(): string | undefined {
    return this.windowIconPath;
  }

  getWindowTitle(configuredTitle?: string): string {
    return configuredTitle || this.info.name;
  }

  private loadLogo(
    configuredPath: string | undefined,
    appPath: string,
  ): string | undefined {
    const logoPath = this.resolveAsset(
      configuredPath,
      appPath,
      "logo",
      new Set(Object.keys(LOGO_MIME_TYPES)),
    );
    if (!logoPath) return undefined;

    try {
      const extension = path.extname(logoPath).toLowerCase();
      const contents = fs.readFileSync(logoPath);
      return `data:${LOGO_MIME_TYPES[extension]};base64,${contents.toString(
        "base64",
      )}`;
    } catch (error) {
      log.warn(`Failed to read branding logo at ${logoPath}:`, error);
      return undefined;
    }
  }

  private resolveAsset(
    configuredPath: string | undefined,
    appPath: string,
    label: string,
    supportedExtensions: Set<string>,
  ): string | undefined {
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
      if (!fs.statSync(resolvedPath).isFile()) {
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
}
