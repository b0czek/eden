import * as fs from "fs/promises";
import * as path from "path";
import fg from "fast-glob";
import { GenesisBundler } from "@edenapp/genesis";
import { AppManifest } from "@edenapp/types";
import {
  IPCBridge,
  CommandRegistry,
  EdenNamespace,
  EdenEmitter,
  PermissionRegistry,
} from "../ipc";
import { PackageHandler } from "./PackageHandler";
import { injectable, inject, singleton } from "tsyringe";
import { FilesystemManager } from "../filesystem";

/**
 * Events emitted by the PackageManager
 */
interface PackageNamespaceEvents {
  installed: { manifest: AppManifest };
  uninstalled: { appId: string };
}

@singleton()
@injectable()
@EdenNamespace("package")
export class PackageManager extends EdenEmitter<PackageNamespaceEvents> {
  private appsDirectory: string;
  private prebuiltAppsDirectory: string;
  private installedApps: Map<string, AppManifest> = new Map();
  private packageHandler: PackageHandler;
  private permissionRegistry: PermissionRegistry;
  private readonly filesystemManager: FilesystemManager;

  constructor(
    @inject(IPCBridge) ipcBridge: IPCBridge,
    @inject("appsDirectory") appsDirectory: string,
    @inject("distPath") distPath: string,
    @inject(CommandRegistry) commandRegistry: CommandRegistry,
    @inject(PermissionRegistry) permissionRegistry: PermissionRegistry,
    @inject(FilesystemManager) filesystemManager: FilesystemManager
  ) {
    super(ipcBridge);
    this.appsDirectory = appsDirectory;
    this.prebuiltAppsDirectory = path.join(distPath, "apps", "prebuilt");
    this.permissionRegistry = permissionRegistry;
    this.filesystemManager = filesystemManager;

    // Create and register handler
    this.packageHandler = new PackageHandler(this);
    commandRegistry.registerManager(this.packageHandler);
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
      (app) => app.isPrebuilt
    ).length;
    const installedCount = this.installedApps.size - prebuiltCount;

    console.log(
      `PackageManager initialized. Found ${prebuiltCount} prebuilt apps and ${installedCount} installed apps.`
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
        console.log("No prebuilt apps directory found, skipping...");
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
              "manifest.json"
            );
            const manifestContent = await fs.readFile(manifestPath, "utf-8");
            const manifest: AppManifest = JSON.parse(manifestContent);

            // Mark as prebuilt
            manifest.isPrebuilt = true;

            // Check for dev manifest (dev server running)
            // Look in source apps directory, not dist
            const devManifestPath = path.join(
              __dirname,
              "../../../apps", // Go up to project root, then into apps
              ...entry.name.split("."),
              ".dev-manifest.json"
            );

            try {
              const devManifestContent = await fs.readFile(
                devManifestPath,
                "utf-8"
              );
              const devManifest = JSON.parse(devManifestContent);

              if (
                devManifest.devMode &&
                devManifest.devUrl &&
                manifest.frontend
              ) {
                // Override frontend entry with dev server URL
                manifest.frontend.entry = devManifest.devUrl;
                console.log(
                  `Loaded prebuilt app: ${manifest.id} (dev mode: ${devManifest.devUrl})`
                );
              } else {
                console.log(`Loaded prebuilt app: ${manifest.id}`);
              }
            } catch {
              // No dev manifest, use production build
              console.log(`Loaded prebuilt app: ${manifest.id}`);
            }

            this.installedApps.set(manifest.id, manifest);

            // Register app permissions
            if (manifest.permissions && manifest.permissions.length > 0) {
              this.permissionRegistry.registerApp(
                manifest.id,
                manifest.permissions
              );
            }
          } catch (error) {
            console.warn(
              `Failed to load prebuilt app from ${entry.name}:`,
              error
            );
          }
        }
      }
    } catch (error) {
      console.error("Failed to load prebuilt apps:", error);
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
              "manifest.json"
            );
            const manifestContent = await fs.readFile(manifestPath, "utf-8");
            const manifest: AppManifest = JSON.parse(manifestContent);

            this.installedApps.set(manifest.id, manifest);

            // Register app permissions
            if (manifest.permissions && manifest.permissions.length > 0) {
              this.permissionRegistry.registerApp(
                manifest.id,
                manifest.permissions
              );
            }
          } catch (error) {
            console.warn(`Failed to load app from ${entry.name}:`, error);
          }
        }
      }
    } catch (error) {
      console.error("Failed to load installed apps:", error);
    }
  }

  /**
   * Get info about a package file without installing it
   */
  async getPackageInfo(
    virtualPath: string
  ): Promise<{ success: boolean; manifest?: AppManifest; error?: string }> {
    try {
      const resolvedPath = this.filesystemManager.resolvePath(virtualPath);
      return await GenesisBundler.getInfo(resolvedPath);
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
  async installApp(virtualPath: string): Promise<AppManifest> {
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
          "  genesis build <app-directory>"
      );
    }

    // Get info from the archive first (validates format and reads manifest)
    const info = await GenesisBundler.getInfo(edenitePath);

    if (!info.success || !info.manifest) {
      throw new Error(
        info.error || "Invalid .edenite file: could not read manifest"
      );
    }

    const manifest = info.manifest;

    // Validate manifest
    this.validateManifest(manifest);

    // Check for reserved app IDs
    if (manifest.id === "com.eden") {
      throw new Error(
        `App ID "${manifest.id}" is reserved for Eden system use.\n` +
          `Please choose a different app ID.`
      );
    }

    // Check if already installed
    if (this.installedApps.has(manifest.id)) {
      throw new Error(
        `App ${manifest.id} is already installed.\n` +
          `Please uninstall the existing version first.`
      );
    }

    // Extract to apps directory using genesis
    const targetPath = path.join(this.appsDirectory, manifest.id);

    const result = await GenesisBundler.extract({
      edenitePath,
      outputDirectory: targetPath,
      verbose: false,
      verifyChecksum: true,
    });

    if (!result.success) {
      throw new Error(result.error || "Failed to extract .edenite file");
    }

    // Register app and its permissions
    this.installedApps.set(manifest.id, manifest);

    if (manifest.permissions && manifest.permissions.length > 0) {
      this.permissionRegistry.registerApp(manifest.id, manifest.permissions);
    }

    this.notify("installed", { manifest });

    return manifest;
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
    // The handler should coordinate this, or we assume it's stopped.
    // For safety, we might want to emit an event "request-app-stop" or similar?
    // Or just let the caller handle it.
    // The user said "packagemanager (install/uninstallation)".
    // I will assume the caller (PackageHandler or Eden) ensures the app is stopped.

    // Remove from disk
    const appPath = path.join(this.appsDirectory, appId);
    await fs.rm(appPath, { recursive: true, force: true });

    // Unregister
    this.installedApps.delete(appId);

    this.notify("uninstalled", { appId });

    return true;
  }

  /**
   * Get list of installed apps
   * @param showHidden - If true, includes overlay apps and daemons (hidden by default)
   */
  getInstalledApps(showHidden: boolean = false): AppManifest[] {
    const apps = Array.from(this.installedApps.values());
    return showHidden
      ? apps
      : apps.filter(
          (app) =>
            (app.hidden !== undefined ? !app.hidden : !app.overlay) &&
            !!app.frontend?.entry
        );
  }

  /**
   * Get manifest for an app
   */
  getAppManifest(appId: string): AppManifest | undefined {
    return this.installedApps.get(appId);
  }

  /**
   * Validate app manifest
   */
  private validateManifest(manifest: AppManifest): void {
    if (!manifest.id || !manifest.name || !manifest.version) {
      throw new Error(
        "Invalid manifest: missing required fields (id, name, version)"
      );
    }

    // At least one of frontend or backend must be defined
    if (!manifest.frontend?.entry && !manifest.backend?.entry) {
      throw new Error(
        "Invalid manifest: must have at least frontend.entry or backend.entry"
      );
    }

    if (manifest.backend && !manifest.backend.entry) {
      throw new Error(
        "Invalid manifest: backend.entry must be specified when backend is defined"
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
    const updatedManifest: AppManifest = JSON.parse(manifestContent);

    // Preserve prebuilt flag
    if (manifest.isPrebuilt) {
      updatedManifest.isPrebuilt = true;
    }

    // Update in-memory manifest
    this.installedApps.set(appId, updatedManifest);

    // Notify about the reload (ProcessManager should handle restarting)
    this.notify("installed", { manifest: updatedManifest });
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
      console.warn(`Failed to read icon for ${appId}:`, error);
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
      console.warn(`Failed to calculate size for ${appId}:`, error);
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
