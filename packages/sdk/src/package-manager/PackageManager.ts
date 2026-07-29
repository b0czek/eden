import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as genesisBundler from "@edenapp/genesis";
import type {
  AppManifest,
  EdenConfig,
  RuntimeAppManifest,
} from "@edenapp/types";
import { inject, injectable, singleton } from "tsyringe";
import { AppCatalog } from "../app-registry";
import { AppRegistry } from "../app-registry/AppRegistry";
import { FilesystemManager } from "../filesystem";
import { normalizeGrantPresets } from "../grants/GrantPresets";
import {
  getHotReloadDevUrl,
  isHotReloadConfigured,
  isHotReloadEnabled,
  toggleHotReload,
} from "../hotreload-config";
import {
  CommandRegistry,
  EdenEmitter,
  EdenNamespace,
  IPCBridge,
  PermissionRegistry,
} from "../ipc";
import { log } from "../logging";
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
  private packageHandler: PackageHandler;
  private coreApps: Set<string>;
  private restrictedApps: Set<string>;

  constructor(
    @inject(IPCBridge) ipcBridge: IPCBridge,
    @inject("appsDirectory") private readonly appsDirectory: string,
    @inject("distPath") distPath: string,
    @inject("EdenConfig") private readonly config: EdenConfig,
    @inject(CommandRegistry) commandRegistry: CommandRegistry,
    @inject(PermissionRegistry)
    private readonly permissionRegistry: PermissionRegistry,
    @inject(FilesystemManager)
    private readonly filesystemManager: FilesystemManager,
    @inject(AppRegistry) private readonly appRegistry: AppRegistry,
    @inject(AppCatalog) private readonly appCatalog: AppCatalog,
  ) {
    super(ipcBridge);
    this.prebuiltAppsDirectory = path.join(distPath, "apps", "prebuilt");
    this.coreApps = normalizeAppIds(this.config.coreApps);
    this.restrictedApps = normalizeAppIds(this.config.restrictedApps);

    // Create and register handler
    this.packageHandler = new PackageHandler(this, appCatalog);
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

  private async applyHotReloadEntry(
    manifest: AppManifest,
  ): Promise<AppManifest> {
    if (!isHotReloadConfigured(this.config) || !manifest.frontend?.entry) {
      return manifest;
    }

    const devUrl = await getHotReloadDevUrl(manifest.id, this.config);
    if (!devUrl) {
      return manifest;
    }

    return {
      ...manifest,
      frontend: {
        ...manifest.frontend,
        entry: devUrl,
      },
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

    const prebuiltCount = this.appCatalog.prebuilt().length;
    const installedCount = this.appCatalog.installed().length;

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
            const rawManifest = await this.applyHotReloadEntry(
              JSON.parse(manifestContent) as AppManifest,
            );
            log.info(
              `Loaded prebuilt app: ${rawManifest.id}${
                rawManifest.frontend?.entry.startsWith("http")
                  ? ` (hot reload: ${rawManifest.frontend.entry})`
                  : ""
              }`,
            );

            const runtimeManifest = this.toRuntimeManifest(rawManifest, true);
            this.appRegistry.register(runtimeManifest);

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
            const rawManifest = await this.applyHotReloadEntry(
              JSON.parse(manifestContent) as AppManifest,
            );
            const runtimeManifest = this.toRuntimeManifest(rawManifest, false);

            this.appRegistry.register(runtimeManifest);

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
      const resolvedPath =
        await this.filesystemManager.resolvePath(virtualPath);
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
    const edenitePath = await this.filesystemManager.resolvePath(virtualPath);

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
    const validation = genesisBundler.validateManifestObject(rawManifest);
    if (!validation.valid) {
      throw new Error(`Invalid manifest: ${validation.errors.join("; ")}`);
    }

    // Check for reserved app IDs
    if (rawManifest.id === "com.eden") {
      throw new Error(
        `App ID "${rawManifest.id}" is reserved for Eden system use.\n` +
          `Please choose a different app ID.`,
      );
    }

    // Check if already installed
    if (this.appCatalog.has(rawManifest.id)) {
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
    this.appRegistry.register(runtimeManifest);
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
    const manifest = this.appCatalog.get(appId);
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
    this.appRegistry.unregister(appId);

    this.notify("uninstalled", { appId });

    return true;
  }

  /**
   * Reload an app (for hot reload support)
   * This will notify that the app has been updated
   */
  async reloadApp(appId: string): Promise<void> {
    const manifest = this.appCatalog.get(appId);
    if (!manifest) {
      throw new Error(`App ${appId} not found`);
    }

    // Reload the manifest from disk
    const appPath = this.appCatalog.getPath(appId);
    if (!appPath) {
      throw new Error(`App path not found for ${appId}`);
    }

    const manifestPath = path.join(appPath, "manifest.json");
    const manifestContent = await fs.readFile(manifestPath, "utf-8");
    const rawManifest = await this.applyHotReloadEntry(
      JSON.parse(manifestContent) as AppManifest,
    );

    // Convert to runtime manifest, preserving prebuilt status
    const runtimeManifest = this.toRuntimeManifest(
      rawManifest,
      manifest.isPrebuilt,
    );

    // Update in-memory manifest
    this.appRegistry.register(runtimeManifest);
    this.permissionRegistry.registerApp(
      runtimeManifest.id,
      runtimeManifest.permissions,
      runtimeManifest.resolvedGrants,
    );

    // Notify about the reload (ProcessManager should handle restarting)
    this.notify("installed", { manifest: runtimeManifest });
  }

  async isHotReloadEnabled(appId: string): Promise<boolean> {
    return isHotReloadEnabled(appId, this.config);
  }

  async toggleHotReload(appId: string): Promise<boolean> {
    return toggleHotReload(appId, this.config);
  }
}
