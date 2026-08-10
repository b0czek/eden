import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as genesisBundler from "@edenapp/genesis";
import type {
  AppManifest,
  DlcManifest,
  EdenConfig,
  InstalledPackageInfo,
  InstalledPackageManifest,
  PackageManifest,
  PackageOperationPreview,
  RuntimeAppManifest,
  RuntimeDlcManifest,
} from "@edenapp/types";
import { inject, injectable, Lifecycle, scoped } from "tsyringe";
import { ExecutionContext } from "../execution/ExecutionContext";
import { RuntimeContextRegistry } from "../execution/RuntimeContextRegistry";
import { FilesystemManager } from "../filesystem";
import { normalizeGrantPresets } from "../grants/GrantPresets";
import {
  getHotReloadDevUrl,
  isHotReloadConfigured,
  isHotReloadEnabled,
  loadHotReloadAppsState,
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
import { DlcResourceManager } from "./DlcResourceManager";
import { PackageCatalog } from "./PackageCatalog";
import { PackageHandler } from "./PackageHandler";
import { PackageOperationCoordinator } from "./PackageOperationCoordinator";
import { PackageRegistry } from "./PackageRegistry";

/**
 * Events emitted by the PackageManager
 */
interface PackageNamespaceEvents {
  installed: { manifest: InstalledPackageManifest };
  uninstalled:
    | { kind: "app"; packageId: string }
    | { kind: "dlc"; packageId: string; hostAppId: string };
}

const RESERVED_PACKAGE_IDS = new Set([
  "com.eden",
  "settings.db",
  "settings.db-shm",
  "settings.db-wal",
  "storage.db",
  "storage.db-shm",
  "storage.db-wal",
  "users.db",
  "users.db-shm",
  "users.db-wal",
]);

export interface InstalledPackageListOptions {
  showHidden?: boolean;
  showRestricted?: boolean;
  kind?: "app" | "dlc";
  hostAppId?: string;
}

@scoped(Lifecycle.ContainerScoped)
@injectable()
@EdenNamespace("package")
export class PackageManager extends EdenEmitter<PackageNamespaceEvents> {
  private prebuiltPackagesDirectory: string;
  private packageHandler: PackageHandler;
  private coreApps: Set<string>;
  private restrictedApps: Set<string>;
  private readonly changingHostIds = new Map<string, number>();

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
    @inject(PackageRegistry) private readonly registry: PackageRegistry,
    @inject(PackageCatalog) private readonly catalog: PackageCatalog,
    @inject(DlcResourceManager)
    private readonly dlcResources: DlcResourceManager,
    @inject(PackageOperationCoordinator)
    private readonly operations: PackageOperationCoordinator,
    @inject(RuntimeContextRegistry)
    private readonly runtimeContexts: RuntimeContextRegistry,
    @inject(ExecutionContext)
    private readonly executionContext: ExecutionContext,
  ) {
    super(ipcBridge);
    this.prebuiltPackagesDirectory = path.join(distPath, "apps", "prebuilt");
    this.coreApps = normalizeAppIds(this.config.coreApps);
    this.restrictedApps = normalizeAppIds(this.config.restrictedApps);

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
    isDevelopment = false,
  ): RuntimeAppManifest {
    return {
      ...manifest,
      kind: "app",
      isPrebuilt,
      isDevelopment,
      isCore: this.coreApps.has(manifest.id),
      isRestricted: this.restrictedApps.has(manifest.id),
      resolvedGrants: normalizeGrantPresets(manifest.grants, manifest.id),
    };
  }

  private toRuntimeDlcManifest(
    manifest: DlcManifest,
    isPrebuilt = false,
  ): RuntimeDlcManifest {
    return { ...manifest, isPrebuilt };
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
    await fs.mkdir(this.catalog.dlcDirectory, { recursive: true });
    await this.operations.initialize();

    // Discover built-in packages and register apps before resolving DLC hosts.
    const prebuiltDlcs = await this.loadPrebuiltPackages();
    const prebuiltDlcIds = new Set(prebuiltDlcs.map((dlc) => dlc.id));

    // Load installed apps
    await this.loadInstalledApps(prebuiltDlcIds);

    // Development sources intentionally win over installed and prebuilt apps.
    if (this.config.development) {
      await this.loadDevelopmentApps(prebuiltDlcIds);
    }

    await this.loadPrebuiltDlcs(prebuiltDlcs);
    await this.loadInstalledDlcs(prebuiltDlcIds);
    this.dlcResources.initialize();

    const prebuiltAppCount = this.catalog.prebuiltApps().length;
    const installedAppCount = this.catalog.installedApps().length;
    const prebuiltDlcCount = this.catalog
      .allDlcs()
      .filter((dlc) => dlc.isPrebuilt).length;
    const installedDlcCount = this.catalog.allDlcs().length - prebuiltDlcCount;

    log.info(
      `PackageManager initialized. Found ${prebuiltAppCount} built-in apps, ${prebuiltDlcCount} built-in DLCs, ${installedAppCount} installed apps, and ${installedDlcCount} installed DLCs.`,
    );
  }

  private async loadDevelopmentApps(
    prebuiltDlcIds: ReadonlySet<string>,
  ): Promise<void> {
    const state = await loadHotReloadAppsState(this.config);
    for (const entry of state.apps) {
      try {
        const sourcePath = path.resolve(entry.sourcePath);
        const parsed = JSON.parse(
          await fs.readFile(path.join(sourcePath, "manifest.json"), "utf-8"),
        ) as PackageManifest;
        const validation = genesisBundler.validatePackageManifestObject(parsed);
        if (
          !validation.valid ||
          !validation.manifest ||
          validation.manifest.kind === "dlc"
        ) {
          throw new Error(
            `Invalid development app manifest: ${validation.errors.join("; ")}`,
          );
        }
        const rawManifest = await this.applyHotReloadEntry(validation.manifest);
        if (rawManifest.id !== entry.id) {
          throw new Error(
            `apps.json id ${entry.id} does not match ${rawManifest.id}`,
          );
        }
        if (prebuiltDlcIds.has(rawManifest.id)) {
          throw new Error(
            `Development app ID ${rawManifest.id} is reserved by a built-in DLC`,
          );
        }
        const runtimeManifest = this.toRuntimeManifest(
          rawManifest,
          false,
          true,
        );
        this.registry.register(runtimeManifest, { sourcePath });
        this.permissionRegistry.registerApp(
          runtimeManifest.id,
          runtimeManifest.permissions,
          runtimeManifest.resolvedGrants,
        );
        log.info(`Mounted development app: ${entry.id} (${sourcePath})`);
      } catch (error) {
        log.warn(`Failed to mount development app ${entry.id}:`, error);
      }
    }
  }

  /**
   * Load built-in packages from dist/apps/prebuilt. Apps are registered
   * immediately; DLCs are returned for host validation after app precedence
   * has been resolved.
   */
  private async loadPrebuiltPackages(): Promise<DlcManifest[]> {
    const dlcs: DlcManifest[] = [];
    const packageIds = new Set<string>();
    try {
      // Check if prebuilt directory exists
      try {
        await fs.access(this.prebuiltPackagesDirectory);
      } catch {
        log.info("No built-in package directory found, skipping...");
        return dlcs;
      }

      const entries = await fs.readdir(this.prebuiltPackagesDirectory, {
        withFileTypes: true,
      });

      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith(".")) {
          try {
            const manifestPath = path.join(
              this.prebuiltPackagesDirectory,
              entry.name,
              "manifest.json",
            );
            const manifestContent = await fs.readFile(manifestPath, "utf-8");
            const parsed = JSON.parse(manifestContent) as PackageManifest;
            const validation =
              genesisBundler.validatePackageManifestObject(parsed);
            if (!validation.valid || !validation.manifest) {
              throw new Error(
                `Invalid package manifest: ${validation.errors.join("; ")}`,
              );
            }
            if (packageIds.has(validation.manifest.id)) {
              throw new Error(`Duplicate package ID ${validation.manifest.id}`);
            }
            packageIds.add(validation.manifest.id);
            if (validation.manifest.kind === "dlc") {
              dlcs.push(validation.manifest);
              continue;
            }
            const rawManifest = await this.applyHotReloadEntry(
              validation.manifest,
            );
            log.info(
              `Loaded built-in app: ${rawManifest.id}${
                rawManifest.frontend?.entry.startsWith("http")
                  ? ` (hot reload: ${rawManifest.frontend.entry})`
                  : ""
              }`,
            );

            const runtimeManifest = this.toRuntimeManifest(rawManifest, true);
            this.registry.register(runtimeManifest);

            // Register app permissions
            this.permissionRegistry.registerApp(
              runtimeManifest.id,
              runtimeManifest.permissions,
              runtimeManifest.resolvedGrants,
            );
          } catch (error) {
            log.warn(
              `Failed to load built-in package from ${entry.name}:`,
              error,
            );
          }
        }
      }
    } catch (error) {
      log.error("Failed to load built-in packages:", error);
    }
    return dlcs;
  }

  private async loadPrebuiltDlcs(manifests: DlcManifest[]): Promise<void> {
    for (const rawManifest of manifests) {
      try {
        if (this.catalog.has(rawManifest.id)) {
          throw new Error(`Duplicate package ID ${rawManifest.id}`);
        }
        const host = this.catalog.getApp(rawManifest.hostAppId);
        if (!host) {
          throw new Error(`Host app ${rawManifest.hostAppId} is not installed`);
        }
        const compatibility = genesisBundler.isDlcCompatible(host, rawManifest);
        if (!compatibility.compatible) {
          throw new Error(compatibility.errors.join("; "));
        }
        const manifest = this.toRuntimeDlcManifest(rawManifest, true);
        this.registry.register(manifest);
        log.info(`Loaded built-in DLC: ${manifest.id}`);
      } catch (error) {
        log.warn(`Failed to load built-in DLC ${rawManifest.id}:`, error);
      }
    }
  }

  private async loadInstalledDlcs(
    prebuiltDlcIds: ReadonlySet<string>,
  ): Promise<void> {
    const entries = await fs.readdir(this.catalog.dlcDirectory, {
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const parsed = JSON.parse(
          await fs.readFile(
            path.join(this.catalog.dlcDirectory, entry.name, "manifest.json"),
            "utf-8",
          ),
        ) as PackageManifest;
        const validation = genesisBundler.validatePackageManifestObject(parsed);
        if (!validation.valid || validation.manifest?.kind !== "dlc") {
          throw new Error(
            `Invalid DLC manifest: ${validation.errors.join("; ")}`,
          );
        }
        const manifest = this.toRuntimeDlcManifest(validation.manifest);
        if (prebuiltDlcIds.has(manifest.id)) {
          throw new Error(
            `Package ID ${manifest.id} is reserved by a built-in DLC`,
          );
        }
        if (this.catalog.has(manifest.id)) {
          throw new Error(`Duplicate package ID ${manifest.id}`);
        }
        const host = this.catalog.getApp(manifest.hostAppId);
        if (!host)
          throw new Error(`Host app ${manifest.hostAppId} is not installed`);
        const compatibility = genesisBundler.isDlcCompatible(host, manifest);
        if (!compatibility.compatible)
          throw new Error(compatibility.errors.join("; "));
        this.registry.register(manifest);
      } catch (error) {
        log.warn(`Failed to load DLC from ${entry.name}:`, error);
      }
    }
  }

  /**
   * Load all installed apps from disk
   */
  private async loadInstalledApps(
    prebuiltDlcIds: ReadonlySet<string>,
  ): Promise<void> {
    try {
      const entries = await fs.readdir(this.appsDirectory, {
        withFileTypes: true,
      });

      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith(".")) {
          try {
            const manifestPath = path.join(
              this.appsDirectory,
              entry.name,
              "manifest.json",
            );
            const manifestContent = await fs.readFile(manifestPath, "utf-8");
            const parsed = JSON.parse(manifestContent) as PackageManifest;
            const validation =
              genesisBundler.validatePackageManifestObject(parsed);
            if (
              !validation.valid ||
              !validation.manifest ||
              validation.manifest.kind === "dlc"
            ) {
              throw new Error(
                `Invalid app manifest: ${validation.errors.join("; ")}`,
              );
            }
            const rawManifest = await this.applyHotReloadEntry(
              validation.manifest,
            );
            if (prebuiltDlcIds.has(rawManifest.id)) {
              throw new Error(
                `Package ID ${rawManifest.id} is reserved by a built-in DLC`,
              );
            }
            const existing = this.catalog.get(rawManifest.id);
            if (existing) {
              throw new Error(
                existing.isPrebuilt
                  ? `Package ID ${rawManifest.id} is reserved by a built-in package`
                  : `Duplicate package ID ${rawManifest.id}`,
              );
            }
            const runtimeManifest = this.toRuntimeManifest(rawManifest, false);

            this.registry.register(runtimeManifest);

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
  async getPackageInfo(virtualPath: string): Promise<{
    success: boolean;
    manifest?: PackageManifest;
    preview?: PackageOperationPreview;
    error?: string;
  }> {
    try {
      const resolvedPath = await this.resolvePackageSource(virtualPath);
      const info = await genesisBundler.getInfo(resolvedPath);
      if (!info.success || !info.manifest) return info;
      const manifest = info.manifest;
      if (manifest.kind === "dlc") {
        const host = this.catalog.getApp(manifest.hostAppId);
        const existing = this.catalog.getDlc(manifest.id);
        const compatibilityErrors = host
          ? genesisBundler.isDlcCompatible(host, manifest).errors
          : [`Host app ${manifest.hostAppId} is not installed`];
        return {
          ...info,
          preview: {
            kind: "dlc",
            existingVersion: existing?.version,
            host,
            compatibilityErrors,
            hostRunning:
              (!!host && !!this.runtimeContexts.get(host.id)) ||
              (!!existing && !!this.runtimeContexts.get(existing.hostAppId)),
            replaceable: !existing?.isPrebuilt,
          },
        };
      }
      const existing = this.catalog.getApp(manifest.id);
      const incompatibleDlcs = this.getIncompatibleDlcs(manifest);
      return {
        ...info,
        preview: {
          kind: "app",
          existingVersion: existing?.version,
          incompatibleDlcs,
          hostRunning: !!existing && !!this.runtimeContexts.get(existing.id),
          replaceable:
            (!existing || (!existing.isPrebuilt && !existing.isDevelopment)) &&
            incompatibleDlcs.every((dlc) => !dlc.isPrebuilt),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  listInstalledPackages(
    options: InstalledPackageListOptions & { kind: "app" },
  ): RuntimeAppManifest[];
  listInstalledPackages(
    options: InstalledPackageListOptions & { kind: "dlc" },
  ): RuntimeDlcManifest[];
  listInstalledPackages(
    options?: InstalledPackageListOptions,
  ): InstalledPackageManifest[];
  listInstalledPackages(
    options: InstalledPackageListOptions = {},
  ): InstalledPackageManifest[] {
    const apps = options.kind === "dlc" ? [] : this.catalog.listApps(options);
    const dlcs =
      options.kind === "app"
        ? []
        : options.hostAppId
          ? this.catalog.dlcsForHost(options.hostAppId)
          : this.catalog.allDlcs();
    return [...apps, ...dlcs];
  }

  getInstalledPackage(packageId: string): InstalledPackageManifest | undefined {
    return this.catalog.get(packageId);
  }

  getAppForLaunch(appId: string): RuntimeAppManifest | undefined {
    return this.changingHostIds.has(appId)
      ? undefined
      : this.catalog.getApp(appId);
  }

  getInstalledPackageInfo(
    packageId: string,
    webContentsId?: number,
  ): InstalledPackageInfo | undefined {
    const manifest = this.getInstalledPackage(packageId);
    if (!manifest) return undefined;
    if (manifest.kind === "dlc") return { manifest, dlcs: [] };
    return {
      manifest,
      dlcs: this.dlcResources.list(manifest.id, webContentsId),
    };
  }

  async getPackageIcon(packageId: string): Promise<string | undefined> {
    return this.catalog.getIcon(packageId);
  }

  async getPackageSize(packageId: string): Promise<number | undefined> {
    return this.catalog.getSize(packageId);
  }

  /** Install an app or DLC from a .edenite file. */
  async installPackage(
    virtualPath: string,
    replacementConfirmed = false,
  ): Promise<InstalledPackageManifest> {
    const edenitePath = await this.resolvePackageSource(virtualPath);
    const info = await this.readPackageInfo(edenitePath);
    const rawManifest = info.manifest;
    this.assertPackageIdAvailable(rawManifest.id);
    return this.operations.runExclusive(() =>
      this.installPackageExclusive(
        edenitePath,
        rawManifest,
        replacementConfirmed,
      ),
    );
  }

  private async installPackageExclusive(
    edenitePath: string,
    rawManifest: PackageManifest,
    replacementConfirmed: boolean,
  ): Promise<InstalledPackageManifest> {
    if (rawManifest.kind === "dlc") {
      if (this.catalog.hasApp(rawManifest.id)) {
        throw new Error(
          `Package ID ${rawManifest.id} is already used by an app`,
        );
      }
      const host = this.catalog.getApp(rawManifest.hostAppId);
      if (!host) {
        throw new Error(`Host app ${rawManifest.hostAppId} is not installed`);
      }
      const existing = this.catalog.getDlc(rawManifest.id);
      return this.runWithHostsChanging(
        [host.id, ...(existing ? [existing.hostAppId] : [])],
        () =>
          this.installDlc(
            edenitePath,
            rawManifest,
            host,
            existing,
            replacementConfirmed,
          ),
      );
    }
    if (this.catalog.hasDlc(rawManifest.id)) {
      throw new Error(`Package ID ${rawManifest.id} is already used by a DLC`);
    }
    const existing = this.catalog.getApp(rawManifest.id);
    return this.runWithHostsChanging([rawManifest.id], () =>
      this.installApp(edenitePath, rawManifest, existing, replacementConfirmed),
    );
  }

  private async installApp(
    edenitePath: string,
    rawManifest: AppManifest,
    existing: RuntimeAppManifest | undefined,
    replacementConfirmed: boolean,
  ): Promise<RuntimeAppManifest> {
    if (existing) {
      if (existing.isPrebuilt || existing.isDevelopment) {
        throw new Error(
          `Cannot replace ${existing.id}: it is prebuilt or mounted for development`,
        );
      }
      this.assertHostStopped(existing.id);
      if (!replacementConfirmed) {
        throw new Error(
          this.replacementRequiredMessage(
            existing.version,
            rawManifest.version,
          ),
        );
      }
    }
    const incompatibleDlcs = this.getIncompatibleDlcs(rawManifest);
    const protectedDlc = incompatibleDlcs.find((dlc) => dlc.isPrebuilt);
    if (protectedDlc) {
      throw new Error(
        `Cannot replace ${rawManifest.id}: bundled DLC ${protectedDlc.id} would become incompatible`,
      );
    }
    const targetPath = path.join(this.appsDirectory, rawManifest.id);
    await this.operations.execute([
      {
        target: targetPath,
        prepare: async (stage) => {
          const result = await genesisBundler.extract({
            edenitePath,
            outputDirectory: stage,
            verifyChecksum: true,
          });
          if (!result.success || result.manifest?.kind === "dlc") {
            throw new Error(result.error || "Failed to extract app package");
          }
        },
      },
      ...incompatibleDlcs.map((dlc) => ({
        target: path.join(this.catalog.dlcDirectory, dlc.id),
      })),
    ]);
    for (const dlc of incompatibleDlcs) this.unregisterDlc(dlc);
    const runtimeManifest = this.toRuntimeManifest(rawManifest, false);
    this.registry.register(runtimeManifest);
    this.permissionRegistry.registerApp(
      runtimeManifest.id,
      runtimeManifest.permissions,
      runtimeManifest.resolvedGrants,
    );

    this.notify("installed", { manifest: runtimeManifest });

    return runtimeManifest;
  }

  /** Uninstall an app or DLC by package ID. */
  async uninstallPackage(packageId: string): Promise<boolean> {
    return this.operations.runExclusive(() =>
      this.uninstallPackageExclusive(packageId),
    );
  }

  private async uninstallPackageExclusive(packageId: string): Promise<boolean> {
    const dlc = this.catalog.getDlc(packageId);
    if (dlc) {
      return this.runWithHostsChanging([dlc.hostAppId], () =>
        this.uninstallDlc(dlc),
      );
    }

    const manifest = this.catalog.getApp(packageId);
    if (!manifest) {
      return false;
    }

    return this.runWithHostsChanging([manifest.id], () =>
      this.uninstallApp(manifest),
    );
  }

  private async uninstallApp(manifest: RuntimeAppManifest): Promise<boolean> {
    if (manifest.isPrebuilt || manifest.isDevelopment) {
      throw new Error(`Cannot uninstall ${manifest.id}: this is a system app.`);
    }
    this.assertHostStopped(manifest.id);
    const dlcs = this.catalog.dlcsForHost(manifest.id);
    const protectedDlc = dlcs.find((dlc) => dlc.isPrebuilt);
    if (protectedDlc) {
      throw new Error(
        `Cannot uninstall ${manifest.id}: it owns bundled DLC ${protectedDlc.id}`,
      );
    }
    await this.operations.execute([
      { target: path.join(this.appsDirectory, manifest.id) },
      ...dlcs.map((dlc) => ({
        target: path.join(this.catalog.dlcDirectory, dlc.id),
      })),
    ]);
    for (const dlc of dlcs) this.unregisterDlc(dlc);
    this.registry.unregister(manifest.id);
    this.permissionRegistry.unregisterApp(manifest.id);

    this.notify("uninstalled", { kind: "app", packageId: manifest.id });

    return true;
  }

  /**
   * Reload an app (for hot reload support)
   * This will notify that the app has been updated
   */
  async reloadPackage(packageId: string): Promise<void> {
    const manifest = this.requireInstalledApp(packageId);

    // Reload the manifest from disk
    const appPath = this.catalog.getPath(packageId);
    if (!appPath) {
      throw new Error(`App path not found for ${packageId}`);
    }

    const manifestPath = path.join(appPath, "manifest.json");
    const manifestContent = await fs.readFile(manifestPath, "utf-8");
    const validation = genesisBundler.validatePackageManifestObject(
      JSON.parse(manifestContent),
    );
    if (
      !validation.valid ||
      !validation.manifest ||
      validation.manifest.kind === "dlc"
    ) {
      throw new Error(
        `Invalid development manifest: ${validation.errors.join("; ")}`,
      );
    }
    const rawManifest = await this.applyHotReloadEntry(validation.manifest);
    if (rawManifest.id !== packageId) {
      throw new Error(
        `App ID changed from ${packageId} to ${rawManifest.id}; restart the development host`,
      );
    }
    const incompatibleDlcs = this.getIncompatibleDlcs(rawManifest);
    if (incompatibleDlcs.length > 0) {
      throw new Error(
        `Development reload would invalidate DLCs: ${incompatibleDlcs.map((dlc) => dlc.id).join(", ")}`,
      );
    }

    // Convert to runtime manifest, preserving prebuilt status
    const runtimeManifest = this.toRuntimeManifest(
      rawManifest,
      manifest.isPrebuilt,
      manifest.isDevelopment,
    );

    // Update in-memory manifest
    this.registry.register(runtimeManifest);
    this.permissionRegistry.registerApp(
      runtimeManifest.id,
      runtimeManifest.permissions,
      runtimeManifest.resolvedGrants,
    );

    // Notify about the reload (ProcessManager should handle restarting)
    this.notify("installed", { manifest: runtimeManifest });
  }

  private async installDlc(
    edenitePath: string,
    manifest: DlcManifest,
    host: RuntimeAppManifest,
    existing: RuntimeDlcManifest | undefined,
    replacementConfirmed = false,
  ): Promise<RuntimeDlcManifest> {
    const compatibility = genesisBundler.isDlcCompatible(host, manifest);
    if (!compatibility.compatible) {
      throw new Error(
        `DLC is incompatible with its host: ${compatibility.errors.join("; ")}`,
      );
    }
    this.assertHostStopped(host.id);
    if (existing?.isPrebuilt) {
      throw new Error(`Cannot replace ${manifest.id}: it is a bundled DLC`);
    }
    if (existing) this.assertHostStopped(existing.hostAppId);
    if (existing && !replacementConfirmed) {
      throw new Error(
        this.replacementRequiredMessage(existing.version, manifest.version),
      );
    }
    const target = path.join(this.catalog.dlcDirectory, manifest.id);
    await this.operations.execute([
      {
        target,
        prepare: async (stage) => {
          const result = await genesisBundler.extract({
            edenitePath,
            outputDirectory: stage,
            verifyChecksum: true,
          });
          if (!result.success || result.manifest?.kind !== "dlc") {
            throw new Error(result.error || "Failed to extract DLC package");
          }
        },
      },
    ]);
    const runtimeManifest = this.toRuntimeDlcManifest(manifest);
    this.registry.register(runtimeManifest);
    this.notify("installed", { manifest: runtimeManifest });
    return runtimeManifest;
  }

  private async uninstallDlc(manifest: RuntimeDlcManifest): Promise<boolean> {
    if (manifest.isPrebuilt) {
      throw new Error(`Cannot uninstall ${manifest.id}: it is a bundled DLC`);
    }
    this.assertHostStopped(manifest.hostAppId);
    await this.operations.execute([
      { target: path.join(this.catalog.dlcDirectory, manifest.id) },
    ]);
    this.unregisterDlc(manifest);
    return true;
  }

  private unregisterDlc(manifest: RuntimeDlcManifest): void {
    this.registry.unregister(manifest.id);
    this.notify("uninstalled", {
      kind: "dlc",
      packageId: manifest.id,
      hostAppId: manifest.hostAppId,
    });
  }

  private getIncompatibleDlcs(host: AppManifest): RuntimeDlcManifest[] {
    return this.catalog
      .dlcsForHost(host.id)
      .filter((dlc) => !genesisBundler.isDlcCompatible(host, dlc).compatible);
  }

  private assertHostStopped(appId: string): void {
    if (this.runtimeContexts.get(appId)) {
      throw new Error(
        `Host app ${appId} must be stopped before changing packages`,
      );
    }
  }

  private async runWithHostsChanging<T>(
    appIds: Iterable<string>,
    operation: () => Promise<T>,
  ): Promise<T> {
    const ids = [...new Set(appIds)];
    for (const appId of ids) {
      this.changingHostIds.set(
        appId,
        (this.changingHostIds.get(appId) ?? 0) + 1,
      );
    }

    try {
      return await operation();
    } finally {
      for (const appId of ids) {
        const depth = this.changingHostIds.get(appId);
        if (depth === undefined || depth <= 1) {
          this.changingHostIds.delete(appId);
        } else {
          this.changingHostIds.set(appId, depth - 1);
        }
      }
    }
  }

  private replacementRequiredMessage(from: string, to: string): string {
    const operation = from === to ? "reinstall" : "replacement";
    return `Explicit ${operation} confirmation is required (${from} → ${to})`;
  }

  private assertPackageIdAvailable(packageId: string): void {
    if (packageId.startsWith(".") || RESERVED_PACKAGE_IDS.has(packageId)) {
      throw new Error(
        `Package ID "${packageId}" is reserved for Eden system use`,
      );
    }
  }

  private async readPackageInfo(
    edenitePath: string,
  ): Promise<{ manifest: PackageManifest }> {
    await fs.access(edenitePath).catch(() => {
      throw new Error(`File not found: ${edenitePath}`);
    });
    if (!edenitePath.endsWith(".edenite")) {
      throw new Error("Invalid file format. Please select a .edenite file");
    }
    const info = await genesisBundler.getInfo(edenitePath);
    if (!info.success || !info.manifest) {
      throw new Error(info.error || "Invalid .edenite package");
    }
    return { manifest: info.manifest };
  }

  private resolvePackageSource(sourcePath: string): Promise<string> {
    return this.executionContext.get()
      ? this.filesystemManager.resolvePath(sourcePath)
      : Promise.resolve(path.resolve(sourcePath));
  }

  async isHotReloadEnabled(packageId: string): Promise<boolean> {
    this.requireInstalledApp(packageId);
    return isHotReloadEnabled(packageId, this.config);
  }

  async toggleHotReload(packageId: string): Promise<boolean> {
    this.requireInstalledApp(packageId);
    return toggleHotReload(packageId, this.config);
  }

  private requireInstalledApp(packageId: string): RuntimeAppManifest {
    const manifest = this.getInstalledPackage(packageId);
    if (!manifest || manifest.kind === "dlc") {
      throw new Error(`Package ${packageId} is not an installed app`);
    }
    return manifest;
  }
}
