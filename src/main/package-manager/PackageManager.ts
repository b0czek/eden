import { EventEmitter } from "events";
import * as fs from "fs/promises";
import * as path from "path";
import AdmZip from "adm-zip";
import { AppManifest, EventName, EventData } from "../../types";
import { IPCBridge } from "../core/IPCBridge";

/**
 * PackageManager
 *
 * Handles app installation, uninstallation, and loading from disk.
 */
export class PackageManager extends EventEmitter {
  private ipcBridge: IPCBridge;
  private appsDirectory: string;
  private installedApps: Map<string, AppManifest> = new Map();

  constructor(ipcBridge: IPCBridge, appsDirectory: string) {
    super();
    this.ipcBridge = ipcBridge;
    this.appsDirectory = appsDirectory;
  }

  /**
   * Type-safe event emitter
   */
  private emitEvent<T extends EventName>(
    event: T,
    data: EventData<T>
  ): boolean {
    return this.emit(event, data);
  }



  /**
   * Initialize the package manager
   */
  async initialize(): Promise<void> {
    // Ensure apps directory exists
    await fs.mkdir(this.appsDirectory, { recursive: true });

    // Load installed apps
    await this.loadInstalledApps();

    console.log(
      `PackageManager initialized. Found ${this.installedApps.size} installed apps.`
    );
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
   * Install an app from a .edenite file
   */
  async installApp(edenitePath: string): Promise<AppManifest> {
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
          "  npm install -g @eden/genesis\n" +
          "  genesis build <app-directory>"
      );
    }

    // Extract the .edenite archive
    const zip = new AdmZip(edenitePath);
    const manifestEntry = zip.getEntry("manifest.json");

    if (!manifestEntry) {
      throw new Error("Invalid .edenite file: missing manifest.json");
    }

    // Read and validate manifest
    const manifestContent = zip.readAsText(manifestEntry);
    const manifest: AppManifest = JSON.parse(manifestContent);

    // Validate manifest
    this.validateManifest(manifest);

    // Check if already installed
    if (this.installedApps.has(manifest.id)) {
      throw new Error(
        `App ${manifest.id} is already installed.\n` +
          `Please uninstall the existing version first.`
      );
    }

    // Extract to apps directory
    const targetPath = path.join(this.appsDirectory, manifest.id);
    await fs.mkdir(targetPath, { recursive: true });

    zip.extractAllTo(targetPath, true);

    // Register app
    this.installedApps.set(manifest.id, manifest);

    this.emitEvent("package/installed", { manifest });

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

    this.emitEvent("package/uninstalled", { appId });
    
    return true;
  }

  /**
   * Get list of installed apps
   */
  getInstalledApps(): AppManifest[] {
    return Array.from(this.installedApps.values());
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

    if (!manifest.frontend?.entry) {
      throw new Error("Invalid manifest: missing frontend.entry");
    }

    if (manifest.backend && !manifest.backend.entry) {
      throw new Error(
        "Invalid manifest: backend.entry must be specified when backend is defined"
      );
    }
  }



}
