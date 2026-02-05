import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as genesisBundler from "@edenapp/genesis";
import type {
  AppManifest,
  EdenConfig,
  RuntimeAppManifest,
} from "@edenapp/types";
import fg from "fast-glob";
import { inject, injectable, singleton } from "tsyringe";
import { FilesystemManager } from "../filesystem";
import { normalizeGrantPresets } from "../grants/GrantPresets";
import {
  CommandRegistry,
  EdenEmitter,
  EdenNamespace,
  IPCBridge,
  PermissionRegistry,
} from "../ipc";
import { log } from "../logging";
import { UserManager } from "../user/UserManager";
import { normalizeAppIds } from "../utils/normalize";
import { PackageHandler } from "./PackageHandler";

/**
 * Events emitted by the PackageManager
 */
interface PackageNamespaceEvents {
  installed: { manifest: RuntimeAppManifest };
  uninstalled: { appId: string };
}

@singleton()
@injectable()
@EdenNamespace("package")
export class PackageManager extends EdenEmitter<PackageNamespaceEvents> {
  private prebuiltAppsDirectory: string;
  private installedApps: Map<string, RuntimeAppManifest> = new Map();
  private packageHandler: PackageHandler;
  private coreApps: Set<string>;
  private restrictedApps: Set<string>;

  constructor(
    @inject(IPCBridge) ipcBridge: IPCBridge,
    @inject("appsDirectory") private readonly appsDirectory: string,
    @inject("distPath") distPath: string,
    @inject("EdenConfig") config: EdenConfig,
    @inject(CommandRegistry) commandRegistry: CommandRegistry,
    @inject(PermissionRegistry)
    private readonly permissionRegistry: PermissionRegistry,
    @inject(FilesystemManager)
    private readonly filesystemManager: FilesystemManager,
    @inject(UserManager) private readonly userManager: UserManager,
  ) {
    super(ipcBridge);
    this.prebuiltAppsDirectory = path.join(distPath, "apps", "prebuilt");
    this.coreApps = normalizeAppIds(config.coreApps);
    this.restrictedApps = normalizeAppIds(config.restrictedApps);

    // Create and register handler
    this.packageHandler = new PackageHandler(this);
    commandRegistry.registerManager(this.packageHandler);
  }

  /**
   * Convert a raw AppManifest to RuntimeAppManifest with computed fields.
   */
  private toRuntimeManifest(
    manifest: AppManifest,
    isPrebuilt: boolean,
  ): RuntimeAppManifest {
    return {
      ...manifest,
      isPrebuilt,
      isCore: this.coreApps.has(manifest.id),
      isRestricted: this.restrictedApps.has(manifest.id),
      resolvedGrants: normalizeGrantPresets(manifest.grants, manifest.id),
    };
  }

  /**
   * Initialize the package manager
   */
  async initialize(): Promise<void> {
    // Ensure apps directory exists
    await fs.mkdir(this.appsDirectory, { recursive: true });

    // Load prebuilt apps first (system apps)
    await this.loadPrebuiltApps();

    // Load installed apps
    await this.loadInstalledApps();

    const prebuiltCount = Array.from(this.installedApps.values()).filter(
      (app) => app.isPrebuilt,
    ).length;
    const installedCount = this.installedApps.size - prebuiltCount;

    log.info(
      `PackageManager initialized. Found ${prebuiltCount} prebuilt apps and ${installedCount} installed apps.`,
    );
  }

  /**
   * Load prebuilt apps from dist/apps/prebuilt
   */
  private async loadPrebuiltApps(): Promise<void> {
    try {
      // Check if prebuilt directory exists
      try {
        await fs.access(this.prebuiltAppsDirectory);
      } catch {
        log.info("No prebuilt apps directory found, skipping...");
        return;
      }

      const entries = await fs.readdir(this.prebuiltAppsDirectory, {
        withFileTypes: true,
      });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          try {
            const manifestPath = path.join(
              this.prebuiltAppsDirectory,
              entry.name,
              "manifest.json",
            );
            const manifestContent = await fs.readFile(manifestPath, "utf-8");
            const rawManifest: AppManifest = JSON.parse(manifestContent);

            // Check for dev manifest (dev server running)
            // Look in source apps directory, not dist
            const devManifestPath = path.join(
              __dirname,
              "../../../apps", // Go up to project root, then into apps
              ...entry.name.split("."),
              ".dev-manifest.json",
            );

            try {
              const devManifestContent = await fs.readFile(
                devManifestPath,
                "utf-8",
              );
              const devManifest = JSON.parse(devManifestContent);

              if (
                devManifest.devMode &&
                devManifest.devUrl &&
                rawManifest.frontend
              ) {
                // Override frontend entry with dev server URL
                rawManifest.frontend.entry = devManifest.devUrl;
                log.info(
                  `Loaded prebuilt app: ${rawManifest.id} (dev mode: ${devManifest.devUrl})`,
                );
              } else {
                log.info(`Loaded prebuilt app: ${rawManifest.id}`);
              }
            } catch {
              // No dev manifest, use production build
              log.info(`Loaded prebuilt app: ${rawManifest.id}`);
            }

            const runtimeManifest = this.toRuntimeManifest(rawManifest, true);
            this.installedApps.set(runtimeManifest.id, runtimeManifest);

            // Register app permissions
            this.permissionRegistry.registerApp(
              runtimeManifest.id,
              runtimeManifest.permissions,
              runtimeManifest.resolvedGrants,
            );
          } catch (error) {
            log.warn(`Failed to load prebuilt app from ${entry.name}:`, error);
          }
        }
      }
    } catch (error) {
      log.error("Failed to load prebuilt apps:", error);
    }
  }

  /**
   * Load all installed apps from disk
   */
  private async loadInstalledApps(): Promise<void> {
    try {
      const entries = await fs.readdir(this.appsDirectory, {
        withFileTypes: true,
      });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          try {
            const manifestPath = path.join(
              this.appsDirectory,
              entry.name,
              "manifest.json",
            );
            const manifestContent = await fs.readFile(manifestPath, "utf-8");
            const rawManifest: AppManifest = JSON.parse(manifestContent);
            const runtimeManifest = this.toRuntimeManifest(rawManifest, false);

            this.installedApps.set(runtimeManifest.id, runtimeManifest);

            // Register app permissions
            this.permissionRegistry.registerApp(
              runtimeManifest.id,
              runtimeManifest.permissions,
              runtimeManifest.resolvedGrants,
            );
          } catch (error) {
            log.warn(`Failed to load app from ${entry.name}:`, error);
          }
        }
      }
    } catch (error) {
      log.error("Failed to load installed apps:", error);
    }
  }

  /**
   * Get info about a package file without installing it
   */
  async getPackageInfo(
    virtualPath: string,
  ): Promise<{ success: boolean; manifest?: AppManifest; error?: string }> {
    try {
      const resolvedPath = this.filesystemManager.resolvePath(virtualPath);
      return await genesisBundler.getInfo(resolvedPath);
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Install an app from a .edenite file
   */
  async installApp(virtualPath: string): Promise<RuntimeAppManifest> {
    const edenitePath = this.filesystemManager.resolvePath(virtualPath);

    // Check if file exists
    try {
      await fs.access(edenitePath);
    } catch {
      throw new Error(`File not found: ${edenitePath}`);
    }

    // Check if it's a .edenite file
    if (!edenitePath.endsWith(".edenite")) {
      throw new Error(
        "Invalid file format. Please select a .edenite file.\n" +
          "You can create .edenite files using the genesis bundler:\n" +
          "  npm install -g @edenapp/genesis\n" +
          "  genesis build <app-directory>",
      );
    }

    // Get info from the archive first (validates format and reads manifest)
    const info = await genesisBundler.getInfo(edenitePath);

    if (!info.success || !info.manifest) {
      throw new Error(
        info.error || "Invalid .edenite file: could not read manifest",
      );
    }

    const rawManifest = info.manifest;

    // Validate manifest
    this.validateManifest(rawManifest);

    // Check for reserved app IDs
    if (rawManifest.id === "com.eden") {
      throw new Error(
        `App ID "${rawManifest.id}" is reserved for Eden system use.\n` +
          `Please choose a different app ID.`,
      );
    }

    // Check if already installed
    if (this.installedApps.has(rawManifest.id)) {
      throw new Error(
        `App ${rawManifest.id} is already installed.\n` +
          `Please uninstall the existing version first.`,
      );
    }

    // Extract to apps directory using genesis
    const targetPath = path.join(this.appsDirectory, rawManifest.id);

    const result = await genesisBundler.extract({
      edenitePath,
      outputDirectory: targetPath,
      verbose: false,
      verifyChecksum: true,
    });

    if (!result.success) {
      throw new Error(result.error || "Failed to extract .edenite file");
    }

    // Convert to runtime manifest and register
    const runtimeManifest = this.toRuntimeManifest(rawManifest, false);
    this.installedApps.set(runtimeManifest.id, runtimeManifest);
    this.permissionRegistry.registerApp(
      runtimeManifest.id,
      runtimeManifest.permissions,
      runtimeManifest.resolvedGrants,
    );

    this.notify("installed", { manifest: runtimeManifest });

    return runtimeManifest;
  }

  /**
   * Uninstall an app
   */
  async uninstallApp(appId: string): Promise<boolean> {
    const manifest = this.installedApps.get(appId);
    if (!manifest) {
      return false;
    }

    // Prevent uninstalling prebuilt apps
    if (manifest.isPrebuilt) {
      throw new Error(`Cannot uninstall ${manifest.id}: this is a system app.`);
    }

    // Note: Stopping the app is the responsibility of ProcessManager.

    // Remove from disk
    const appPath = path.join(this.appsDirectory, appId);
    await fs.rm(appPath, { recursive: true, force: true });

    // Unregister
    this.installedApps.delete(appId);

    this.notify("uninstalled", { appId });

    return true;
  }

  /**
   * Get list of installed apps.
   * @param options.showHidden - If true, includes overlay apps and daemons (hidden by default)
   * @param options.showRestricted - If true, includes apps the current user cannot launch (hidden by default)
   */
  getInstalledApps(
    options: { showHidden?: boolean; showRestricted?: boolean } = {},
  ): RuntimeAppManifest[] {
    const { showHidden = false, showRestricted = false } = options;
    const apps = Array.from(this.installedApps.values());
    return apps.filter((app) => {
      // Filter by visibility
      if (!showHidden) {
        const isHidden = app.hidden !== undefined ? app.hidden : app.overlay;
        if (isHidden || !app.frontend?.entry) {
          return false;
        }
      }
      // Filter by user grants
      if (!showRestricted && !this.userManager.canLaunchApp(app.id)) {
        return false;
      }
      return true;
    });
  }

  /**
   * Get manifest for an app
   */
  getAppManifest(appId: string): RuntimeAppManifest | undefined {
    return this.installedApps.get(appId);
  }

  /**
   * Validate app manifest
   */
  private validateManifest(manifest: AppManifest): void {
    if (!manifest.id || !manifest.name || !manifest.version) {
      throw new Error(
        "Invalid manifest: missing required fields (id, name, version)",
      );
    }

    // At least one of frontend or backend must be defined
    if (!manifest.frontend?.entry && !manifest.backend?.entry) {
      throw new Error(
        "Invalid manifest: must have at least frontend.entry or backend.entry",
      );
    }

    if (manifest.backend && !manifest.backend.entry) {
      throw new Error(
        "Invalid manifest: backend.entry must be specified when backend is defined",
      );
    }
  }

  /**
   * Get the installation path for an app
   */
  getAppPath(appId: string): string | undefined {
    const manifest = this.installedApps.get(appId);
    if (!manifest) {
      return undefined;
    }

    // Return the appropriate path based on whether it's prebuilt
    if (manifest.isPrebuilt) {
      return path.join(this.prebuiltAppsDirectory, appId);
    } else {
      return path.join(this.appsDirectory, appId);
    }
  }

  /**
   * Reload an app (for hot reload support)
   * This will notify that the app has been updated
   */
  async reloadApp(appId: string): Promise<void> {
    const manifest = this.installedApps.get(appId);
    if (!manifest) {
      throw new Error(`App ${appId} not found`);
    }

    // Reload the manifest from disk
    const appPath = this.getAppPath(appId);
    if (!appPath) {
      throw new Error(`App path not found for ${appId}`);
    }

    const manifestPath = path.join(appPath, "manifest.json");
    const manifestContent = await fs.readFile(manifestPath, "utf-8");
    const rawManifest: AppManifest = JSON.parse(manifestContent);

    // Convert to runtime manifest, preserving prebuilt status
    const runtimeManifest = this.toRuntimeManifest(
      rawManifest,
      manifest.isPrebuilt,
    );

    // Update in-memory manifest
    this.installedApps.set(appId, runtimeManifest);
    this.permissionRegistry.registerApp(
      runtimeManifest.id,
      runtimeManifest.permissions,
      runtimeManifest.resolvedGrants,
    );

    // Notify about the reload (ProcessManager should handle restarting)
    this.notify("installed", { manifest: runtimeManifest });
  }

  /**
   * Get the app icon as a base64 data URL
   */
  async getAppIcon(appId: string): Promise<string | undefined> {
    const manifest = this.installedApps.get(appId);
    if (!manifest?.icon) {
      return undefined;
    }

    const appPath = this.getAppPath(appId);
    if (!appPath) {
      return undefined;
    }

    const iconPath = path.join(appPath, manifest.icon);

    try {
      const iconBuffer = await fs.readFile(iconPath);
      const ext = path.extname(manifest.icon).toLowerCase();
      const mimeType = this.getMimeType(ext);
      return `data:${mimeType};base64,${iconBuffer.toString("base64")}`;
    } catch (error) {
      log.warn(`Failed to read icon for ${appId}:`, error);
      return undefined;
    }
  }

  /**
   * Get MIME type for an image file extension
   */
  private getMimeType(ext: string): string {
    const mimeTypes: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".svg": "image/svg+xml",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".ico": "image/x-icon",
    };
    return mimeTypes[ext] || "application/octet-stream";
  }

  /**
   * Get the size of an installed app in bytes
   */
  async getAppSize(appId: string): Promise<number | undefined> {
    const appPath = this.getAppPath(appId);
    if (!appPath) {
      return undefined;
    }

    try {
      return await this.getDirectorySize(appPath);
    } catch (error) {
      log.warn(`Failed to calculate size for ${appId}:`, error);
      return undefined;
    }
  }

  private async getDirectorySize(targetPath: string): Promise<number> {
    const files = await fg("**/*", {
      cwd: targetPath,
      stats: true,
      followSymbolicLinks: false,
      onlyFiles: true,
    });
    return files.reduce((sum, file) => sum + (file.stats?.size ?? 0), 0);
  }
}
