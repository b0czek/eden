import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { RuntimeAppManifest } from "@edenapp/types";
import fg from "fast-glob";
import { inject, injectable, singleton } from "tsyringe";
import { ExecutionContext } from "../execution";
import { log } from "../logging";
import { AppRegistry } from "./AppRegistry";
import { DEFAULT_APP_ICON_DATA_URL } from "./defaultAppIcon";

export interface AppCatalogListOptions {
  showHidden?: boolean;
  showRestricted?: boolean;
}

@singleton()
@injectable()
export class AppCatalog {
  private developmentPaths = new Map<string, string>();
  constructor(
    @inject(AppRegistry) private appRegistry: AppRegistry,
    @inject(ExecutionContext) private executionContext: ExecutionContext,
    @inject("appsDirectory") private appsDirectory: string,
    @inject("distPath") private distPath: string,
  ) {}

  get(appId: string): RuntimeAppManifest | undefined {
    return this.appRegistry.get(appId);
  }

  has(appId: string): boolean {
    return this.appRegistry.has(appId);
  }

  all(): RuntimeAppManifest[] {
    return this.appRegistry.list();
  }

  prebuilt(): RuntimeAppManifest[] {
    return this.all().filter((app) => app.isPrebuilt);
  }

  installed(): RuntimeAppManifest[] {
    return this.all().filter((app) => !app.isPrebuilt && !app.isDevelopment);
  }

  development(): RuntimeAppManifest[] {
    return this.all().filter((app) => app.isDevelopment);
  }

  setDevelopmentPath(appId: string, sourcePath: string): void {
    this.developmentPaths.set(appId, sourcePath);
  }

  getPath(appId: string): string | undefined {
    const app = this.get(appId);
    if (!app) return undefined;

    if (app.isDevelopment) return this.developmentPaths.get(appId);
    return app.isPrebuilt
      ? path.join(this.distPath, "apps", "prebuilt", appId)
      : path.join(this.appsDirectory, appId);
  }

  async getIcon(appId: string): Promise<string | undefined> {
    const app = this.get(appId);
    const appPath = this.getPath(appId);
    if (app?.icon && appPath) {
      try {
        const iconPath = path.join(appPath, app.icon);
        const iconBuffer = await fs.readFile(iconPath);
        const mimeType = this.getImageMimeType(
          path.extname(app.icon).toLowerCase(),
        );
        return `data:${mimeType};base64,${iconBuffer.toString("base64")}`;
      } catch (error) {
        log.warn(`Failed to read icon for ${appId}:`, error);
      }
    }

    return DEFAULT_APP_ICON_DATA_URL;
  }

  async getSize(appId: string): Promise<number | undefined> {
    const appPath = this.getPath(appId);
    if (!appPath) return undefined;

    try {
      const files = await fg("**/*", {
        cwd: appPath,
        stats: true,
        followSymbolicLinks: false,
        onlyFiles: true,
      });
      return files.reduce((sum, file) => sum + (file.stats?.size ?? 0), 0);
    } catch (error) {
      log.warn(`Failed to calculate size for ${appId}:`, error);
      return undefined;
    }
  }

  getLaunchable(appId: string): RuntimeAppManifest | undefined {
    const app = this.get(appId);
    return app && this.executionContext.canLaunchApp(appId) ? app : undefined;
  }

  list(options: AppCatalogListOptions = {}): RuntimeAppManifest[] {
    const { showHidden = false, showRestricted = false } = options;

    return this.all().filter((app) => {
      if (!showHidden) {
        const isHidden = app.hidden !== undefined ? app.hidden : app.overlay;
        if (isHidden || !app.frontend?.entry) return false;
      }

      return showRestricted || this.executionContext.canLaunchApp(app.id);
    });
  }

  private getImageMimeType(extension: string): string {
    const mimeTypes: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".svg": "image/svg+xml",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".ico": "image/x-icon",
    };
    return mimeTypes[extension] || "application/octet-stream";
  }
}
