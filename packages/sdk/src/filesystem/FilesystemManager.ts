import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { FileStats, SearchResult } from "@edenapp/types";
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
import {
  type FilesystemChangeKind,
  FilesystemWatcher,
} from "./FilesystemWatcher";

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

  constructor(
    @inject("userDirectory") baseDir: string,
    @inject(CommandRegistry) commandRegistry: CommandRegistry,
    @inject(ExecutionContext) private executionContext: ExecutionContext,
    @inject(delay(() => IPCBridge)) ipcBridge: IPCBridge,
    @inject(delay(() => ViewManager)) private viewManager: ViewManager,
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
   * @param targetPath - The masked path (e.g., "/file.json" or "/Documents/notes.txt")
   * @returns The resolved absolute path (e.g., "/home/user/.eden/file.json")
   * @throws Error if the path attempts to escape the base directory
   */
  async resolvePath(targetPath: string): Promise<string> {
    const effectiveRoot = await this.getEffectiveRoot();
    const relativePath = targetPath.replace(/^[\\/]+/, "");
    const resolved = path.resolve(effectiveRoot, relativePath);

    assertPathWithin(effectiveRoot, resolved, `Path '${targetPath}'`);
    await assertExistingPathWithin(effectiveRoot, resolved);
    return resolved;
  }

  /**
   * Convert an absolute filesystem path back to a masked path (as seen by apps).
   *
   * @param absolutePath - The absolute filesystem path
   * @returns The masked path relative to the base directory
   * @throws Error if the path is outside the base directory
   */
  async toMaskedPath(absolutePath: string): Promise<string> {
    const effectiveRoot = await this.getEffectiveRoot();
    const normalizedAbsolute = path.resolve(absolutePath);

    assertPathWithin(
      effectiveRoot,
      normalizedAbsolute,
      `Path '${absolutePath}'`,
    );
    await assertExistingPathWithin(effectiveRoot, normalizedAbsolute);

    const relativePath = normalizedAbsolute.slice(effectiveRoot.length);
    // Ensure it starts with /
    return relativePath.startsWith("/") ? relativePath : `/${relativePath}`;
  }

  /**
   * Check if a path is within the allowed base directory
   */
  async isPathAllowed(targetPath: string): Promise<boolean> {
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
    targetPath: string,
    encoding: BufferEncoding = "utf-8",
  ): Promise<string> {
    const fullPath = await this.resolvePath(targetPath);
    return await fs.readFile(fullPath, encoding);
  }

  /**
   * Write content to a file, creating directories if needed.
   */
  async writeFile(
    targetPath: string,
    content: string,
    encoding: BufferEncoding = "utf-8",
  ): Promise<void> {
    const fullPath = await this.resolvePath(targetPath);
    // Ensure directory exists
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, encoding);
    this.invalidateHostDirectory(path.dirname(fullPath));
  }

  /**
   * Check if a file or directory exists.
   */
  async exists(targetPath: string): Promise<boolean> {
    try {
      const fullPath = await this.resolvePath(targetPath);
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create a directory and any necessary parent directories.
   */
  async mkdir(targetPath: string): Promise<void> {
    const fullPath = await this.resolvePath(targetPath);
    await fs.mkdir(fullPath, { recursive: true });
    this.invalidateHostDirectory(path.dirname(fullPath));
  }

  /**
   * List contents of a directory.
   */
  async readdir(targetPath: string): Promise<string[]> {
    const fullPath = await this.resolvePath(targetPath);
    return await fs.readdir(fullPath);
  }

  /**
   * Get file or directory statistics.
   */
  async stat(targetPath: string): Promise<FileStats> {
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
    basePath: string,
    pattern: string,
    limit: number = 10,
  ): Promise<SearchResult[]> {
    const fullPath = await this.resolvePath(basePath);

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
          name: path.basename(entry.path),
          path: entryPath,
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
  async delete(targetPath: string): Promise<void> {
    const fullPath = await this.resolvePath(targetPath);

    // Check if it exists and get stats
    const stats = await fs.stat(fullPath);

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
    fromPath: string,
    toPath: string,
    overwrite: boolean = false,
  ): Promise<void> {
    const source = await this.resolvePath(fromPath);
    const destination = await this.resolvePath(toPath);
    await this.transfer.copy({
      source,
      destination,
      destinationLabel: toPath,
      overwrite,
    });
    this.invalidateHostDirectory(path.dirname(destination));
  }

  /**
   * Move or rename a file or directory.
   * Falls back to copy+delete when rename crosses filesystem boundaries.
   */
  async move(
    fromPath: string,
    toPath: string,
    overwrite: boolean = false,
  ): Promise<void> {
    const source = await this.resolvePath(fromPath);
    const destination = await this.resolvePath(toPath);
    await this.transfer.move({
      source,
      destination,
      destinationLabel: toPath,
      overwrite,
    });
    this.invalidateHostDirectory(path.dirname(source));
    this.invalidateHostDirectory(path.dirname(destination));
  }

  async watchDirectory(
    targetPath: string,
    callerWebContentsId: number | undefined,
  ): Promise<{ watchId: string }> {
    const hostPath = await this.resolvePath(targetPath);
    const stats = await fs.stat(hostPath);
    if (!stats.isDirectory()) {
      throw new Error(`Path '${targetPath}' is not a directory`);
    }

    return this.watcher.watch(hostPath, callerWebContentsId);
  }

  unwatch(watchId: string, callerWebContentsId: number | undefined): void {
    this.watcher.unwatch(watchId, callerWebContentsId);
  }

  private invalidateHostDirectory(hostPath: string): void {
    this.watcher.invalidate(hostPath);
  }

  override dispose(): void {
    this.watcher.dispose();
    super.dispose();
  }
}
