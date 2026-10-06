import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  FileStats,
  FilesystemChangeKind,
  FilesystemLocation,
  FilesystemVolume,
  SearchResult,
} from "@edenapp/types";
import fg from "fast-glob";
import { delay, inject, injectable, Lifecycle, scoped } from "tsyringe";
import { ExecutionContext } from "../execution/ExecutionContext";
import { CommandRegistry, EdenEmitter, EdenNamespace, IPCBridge } from "../ipc";
import { log } from "../logging";
import {
  assertExistingPathWithin,
  assertPathWithin,
  normalizeHomeDirectory,
  resolveHomeDirectory,
} from "../user/UserHomeDirectory";
import { ViewManager } from "../view-manager/ViewManager";
import { FilesystemHandler } from "./FilesystemHandler";
import { FilesystemTransfer } from "./FilesystemTransfer";
import { FilesystemWatcher } from "./FilesystemWatcher";
import { VolumeManager } from "./VolumeManager";

interface FilesystemEvents {
  changed: { watchId: string; kind: FilesystemChangeKind };
}
/**
 * FilesystemManager
 *
 * Manages filesystem operations and path resolution.
 */
@scoped(Lifecycle.ContainerScoped)
@injectable()
@EdenNamespace("fs")
export class FilesystemManager extends EdenEmitter<FilesystemEvents> {
  private baseDir: string;
  private handler: FilesystemHandler;
  private readonly transfer = new FilesystemTransfer();
  private readonly watcher: FilesystemWatcher;
  private readonly stopVolumeListener: () => void;

  constructor(
    @inject("userDirectory") baseDir: string,
    @inject(CommandRegistry) commandRegistry: CommandRegistry,
    @inject(ExecutionContext) private executionContext: ExecutionContext,
    @inject(delay(() => IPCBridge)) ipcBridge: IPCBridge,
    @inject(delay(() => ViewManager)) private viewManager: ViewManager,
    @inject(VolumeManager) private volumes: VolumeManager,
  ) {
    super(ipcBridge);
    // Normalize baseDir to an absolute path to ensure proper path resolution
    this.baseDir = path.resolve(baseDir);

    // Create and register handler
    this.handler = new FilesystemHandler(this);
    commandRegistry.registerManager(this.handler);
    this.watcher = new FilesystemWatcher({
      resolveViewId: (webContentsId) =>
        this.viewManager.getViewIdByWebContentsId(webContentsId),
      onViewRemoved: (listener) =>
        this.viewManager.on("view-removed", ({ viewId }) => listener(viewId)),
      notify: (viewId, event) =>
        this.notifySubscriber(viewId, "changed", event),
    });
    this.stopVolumeListener = this.volumes.on(
      "volumes-changed",
      ({ volumes }) => {
        this.watcher.removeUnavailableVolumes(
          new Set(volumes.map((volume) => volume.id)),
        );
      },
    );
  }

  /**
   * Get the base directory (user directory)
   */
  getBaseDir(): string {
    return this.baseDir;
  }

  /**
   * Resolve a masked path (as seen by apps) to an absolute filesystem path.
   *
   * @param location - The volume and masked path (e.g., "/file.json" or "/Documents/notes.txt")
   * @returns The resolved absolute path (e.g., "/home/user/.eden/file.json")
   * @throws Error if the path attempts to escape the base directory
   */
  async resolvePath(location: FilesystemLocation): Promise<string> {
    return (await this.resolveTarget(location)).hostPath;
  }

  listVolumes(): FilesystemVolume[] {
    // Volume discovery is also subject to a valid filesystem principal.
    this.requirePrincipal();
    return this.volumes.list();
  }

  private requirePrincipal(): void {
    const principal = this.executionContext.getPrincipal();
    if (principal?.kind !== "user" && principal?.kind !== "system") {
      throw new Error("Caller has no filesystem execution principal");
    }
  }

  private async resolveTarget(address: FilesystemLocation, write = false) {
    this.requirePrincipal();
    const info = this.volumes.get(address.volume);
    if (write && info.readOnly)
      throw new Error(`Filesystem volume '${address.volume}' is read-only`);
    const mounted = this.volumes.getRoot(address.volume);
    const rootPath = mounted?.rootPath ?? (await this.getEffectiveRoot());
    const assertActive = async () => {
      await mounted?.assertActive();
    };
    await assertActive();
    const relativePath = address.path.replace(/^[\\/]+/, "");
    const hostPath = path.resolve(rootPath, relativePath);
    assertPathWithin(rootPath, hostPath, `Path '${address.path}'`);
    await assertExistingPathWithin(rootPath, hostPath);
    await assertActive();
    return { hostPath, rootPath, assertActive };
  }

  private assertNotRoot(target: { hostPath: string; rootPath: string }): void {
    if (target.hostPath === target.rootPath)
      throw new Error("Cannot delete, move, or replace a volume root");
  }

  /**
   * Convert an absolute filesystem path back to a masked path (as seen by apps).
   *
   * @param absolutePath - The absolute filesystem path
   * @returns The masked path relative to the base directory
   * @throws Error if the path is outside the base directory
   */
  async toMaskedPath(
    absolutePath: string,
    volume: string,
  ): Promise<FilesystemLocation> {
    this.requirePrincipal();
    const mounted = this.volumes.getRoot(volume);
    await mounted?.assertActive();
    const effectiveRoot = mounted?.rootPath ?? (await this.getEffectiveRoot());
    const normalizedAbsolute = path.resolve(absolutePath);

    assertPathWithin(
      effectiveRoot,
      normalizedAbsolute,
      `Path '${absolutePath}'`,
    );
    await assertExistingPathWithin(effectiveRoot, normalizedAbsolute);

    const relativePath = normalizedAbsolute.slice(effectiveRoot.length);
    // Ensure it starts with /
    return {
      volume,
      path: relativePath.startsWith("/") ? relativePath : `/${relativePath}`,
    };
  }

  /**
   * Check if a path is within the allowed base directory
   */
  async isPathAllowed(targetPath: FilesystemLocation): Promise<boolean> {
    try {
      await this.resolvePath(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  private async getEffectiveRoot(): Promise<string> {
    const principal = this.executionContext.getPrincipal();
    if (principal?.kind === "system") {
      return this.baseDir;
    }
    if (principal?.kind !== "user") {
      throw new Error("Caller has no filesystem execution principal");
    }
    const user = principal.profile;

    if (user.role === "vendor") {
      return this.baseDir;
    }

    const homeDirectory = normalizeHomeDirectory(user.homeDirectory);
    if (!homeDirectory) {
      return this.baseDir;
    }

    return resolveHomeDirectory(this.baseDir, homeDirectory);
  }

  // =====================
  // Filesystem Operations
  // =====================

  /**
   * Read the contents of a file.
   */
  async readFile(
    targetPath: FilesystemLocation,
    encoding: BufferEncoding = "utf-8",
  ): Promise<string> {
    const fullPath = await this.resolvePath(targetPath);
    return await fs.readFile(fullPath, encoding);
  }

  /**
   * Read the contents of a file without text encoding.
   */
  async readBinaryFile(targetPath: FilesystemLocation): Promise<Uint8Array> {
    const fullPath = await this.resolvePath(targetPath);
    const content = await fs.readFile(fullPath);
    return new Uint8Array(content);
  }

  /**
   * Write content to a file, creating directories if needed.
   */
  async writeFile(
    targetPath: FilesystemLocation,
    content: string,
    encoding: BufferEncoding = "utf-8",
  ): Promise<void> {
    await this.writeContent(targetPath, content, encoding);
  }

  /**
   * Write bytes to a file, creating directories if needed.
   */
  async writeBinaryFile(
    targetPath: FilesystemLocation,
    content: Uint8Array,
  ): Promise<void> {
    await this.writeContent(targetPath, content);
  }

  private async writeContent(
    targetPath: FilesystemLocation,
    content: string | Uint8Array,
    encoding?: BufferEncoding,
  ): Promise<void> {
    const target = await this.resolveTarget(targetPath, true);
    const fullPath = target.hostPath;
    await target.assertActive();
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await target.assertActive();
    await assertExistingPathWithin(target.rootPath, fullPath);
    await target.assertActive();
    await fs.writeFile(fullPath, content, encoding);
    this.invalidateHostDirectory(path.dirname(fullPath));
  }

  /**
   * Check if a file or directory exists.
   */
  async exists(targetPath: FilesystemLocation): Promise<boolean> {
    try {
      const fullPath = await this.resolvePath(targetPath);
      await fs.access(fullPath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        await this.volumes.getRoot(targetPath.volume)?.assertActive();
        return false;
      }
      throw error;
    }
  }

  /**
   * Create a directory and any necessary parent directories.
   */
  async mkdir(targetPath: FilesystemLocation): Promise<void> {
    const target = await this.resolveTarget(targetPath, true);
    const fullPath = target.hostPath;
    await target.assertActive();
    await fs.mkdir(fullPath, { recursive: true });
    this.invalidateHostDirectory(path.dirname(fullPath));
  }

  /**
   * List contents of a directory.
   */
  async readdir(targetPath: FilesystemLocation): Promise<string[]> {
    const fullPath = await this.resolvePath(targetPath);
    return await fs.readdir(fullPath);
  }

  /**
   * Get file or directory statistics.
   */
  async stat(targetPath: FilesystemLocation): Promise<FileStats> {
    const fullPath = await this.resolvePath(targetPath);
    const stats = await fs.stat(fullPath);
    return {
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      size: stats.size,
      mtime: stats.mtime,
    };
  }

  /**
   * Search for files and directories using glob patterns.
   */
  async search(
    location: FilesystemLocation,
    pattern: string,
    limit: number = 10,
  ): Promise<SearchResult[]> {
    const fullPath = await this.resolvePath(location);

    const basePath = location.path;

    // Create glob pattern
    // If pattern is empty, match everything
    const globPattern = pattern ? `**/*${pattern}*` : "**/*";

    try {
      const entries = await fg(globPattern, {
        cwd: fullPath,
        onlyFiles: false,
        deep: 3, // Limit depth for performance
        suppressErrors: true,
        stats: true,
        followSymbolicLinks: false,
      });

      const results: SearchResult[] = [];
      for (const entry of entries) {
        if (results.length >= limit) break;

        const entryPath =
          basePath === "/" ? `/${entry.path}` : `${basePath}/${entry.path}`;
        const isDirectory = entry.stats?.isDirectory() ?? false;

        results.push({
          location: { volume: location.volume, path: entryPath },
          name: path.basename(entry.path),
          type: isDirectory ? "folder" : "file",
        });
      }

      return results;
    } catch (error) {
      log.error("Search error:", error);
      return [];
    }
  }

  /**
   * Delete a file or directory.
   * For directories, removes recursively.
   */
  async delete(targetPath: FilesystemLocation): Promise<void> {
    const target = await this.resolveTarget(targetPath, true);
    const fullPath = target.hostPath;

    this.assertNotRoot(target);

    // Check if it exists and get stats
    const stats = await fs.stat(fullPath);

    await target.assertActive();
    if (stats.isDirectory()) {
      // Remove directory recursively
      await fs.rm(fullPath, { recursive: true, force: true });
    } else {
      // Remove file
      await fs.unlink(fullPath);
    }
    this.invalidateHostDirectory(path.dirname(fullPath));
  }

  /**
   * Copy a file or directory to another location.
   */
  async copy(
    fromPath: FilesystemLocation,
    toPath: FilesystemLocation,
    overwrite: boolean = false,
  ): Promise<void> {
    const sourceTarget = await this.resolveTarget(fromPath);
    const destinationTarget = await this.resolveTarget(toPath, true);
    this.assertNotRoot(destinationTarget);
    const source = sourceTarget.hostPath;
    const destination = destinationTarget.hostPath;
    await this.transfer.copy({
      source,
      destination,
      destinationLabel: `${toPath.volume}:${toPath.path}`,
      assertSourceActive: sourceTarget.assertActive,
      assertDestinationActive: destinationTarget.assertActive,
      overwrite,
    });
    this.invalidateHostDirectory(path.dirname(destination));
  }

  /**
   * Move or rename a file or directory.
   * Falls back to copy+delete when rename crosses filesystem boundaries.
   */
  async move(
    fromPath: FilesystemLocation,
    toPath: FilesystemLocation,
    overwrite: boolean = false,
  ): Promise<void> {
    const sourceTarget = await this.resolveTarget(fromPath, true);
    const destinationTarget = await this.resolveTarget(toPath, true);
    this.assertNotRoot(sourceTarget);
    this.assertNotRoot(destinationTarget);
    const source = sourceTarget.hostPath;
    const destination = destinationTarget.hostPath;
    await this.transfer.move({
      source,
      destination,
      destinationLabel: `${toPath.volume}:${toPath.path}`,
      assertSourceActive: sourceTarget.assertActive,
      assertDestinationActive: destinationTarget.assertActive,
      overwrite,
    });
    this.invalidateHostDirectory(path.dirname(source));
    this.invalidateHostDirectory(path.dirname(destination));
  }

  async watchDirectory(
    targetPath: FilesystemLocation,
    callerWebContentsId: number | undefined,
  ): Promise<{ watchId: string }> {
    const target = await this.resolveTarget(targetPath);
    if (!this.volumes.get(targetPath.volume).supportsWatch)
      throw new Error("Filesystem volume does not support watching");
    const hostPath = target.hostPath;
    const stats = await fs.stat(hostPath);
    await target.assertActive();
    if (!stats.isDirectory()) {
      throw new Error(`Path '${targetPath.path}' is not a directory`);
    }

    return this.watcher.watch(hostPath, callerWebContentsId, targetPath.volume);
  }

  unwatch(watchId: string, callerWebContentsId: number | undefined): void {
    this.watcher.unwatch(watchId, callerWebContentsId);
  }

  private invalidateHostDirectory(hostPath: string): void {
    this.watcher.invalidate(hostPath);
  }

  override dispose(): void {
    this.stopVolumeListener();
    this.watcher.dispose();
    super.dispose();
  }
}
