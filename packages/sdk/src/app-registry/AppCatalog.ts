import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { RuntimeAppManifest } from "@edenapp/types";
import fg from "fast-glob";
import { inject, injectable, singleton } from "tsyringe";
import { log } from "../logging";
import { UserManager } from "../user/UserManager";
import { AppRegistry } from "./AppRegistry";
import { DEFAULT_APP_ICON_DATA_URL } from "./defaultAppIcon";

export interface AppCatalogListOptions {
  showHidden?: boolean;
  showRestricted?: boolean;
}

@singleton()
@injectable()
export class AppCatalog {
  constructor(
    @inject(AppRegistry) private appRegistry: AppRegistry,
    @inject(UserManager) private userManager: UserManager,
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
    return this.all().filter((app) => !app.isPrebuilt);
  }

  getPath(appId: string): string | undefined {
    const app = this.get(appId);
    if (!app) return undefined;

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
    return app && this.userManager.canLaunchApp(appId) ? app : undefined;
  }

  list(options: AppCatalogListOptions = {}): RuntimeAppManifest[] {
    const { showHidden = false, showRestricted = false } = options;

    return this.all().filter((app) => {
      if (!showHidden) {
        const isHidden = app.hidden !== undefined ? app.hidden : app.overlay;
        if (isHidden || !app.frontend?.entry) return false;
      }

      return showRestricted || this.userManager.canLaunchApp(app.id);
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
