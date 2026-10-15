import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  FileStats,
  FilesystemChangeKind,
  FilesystemHandle,
  FilesystemLocation,
  FilesystemOpenMode,
  FilesystemSource,
  SearchResult,
} from "@edenapp/types";
import fg from "fast-glob";
import { delay, inject, injectable, Lifecycle, scoped } from "tsyringe";
import { ExecutionContext } from "../execution/ExecutionContext";
import { CommandRegistry, EdenEmitter, EdenNamespace, IPCBridge } from "../ipc";
import { log } from "../logging";
import type {
  OperationReporter,
  OperationTask,
} from "../operations/OperationTask";
import type { ProcessManager } from "../process-manager/ProcessManager";
import {
  assertExistingPathWithin,
  assertPathWithin,
  normalizeDirectoryRestriction,
  resolveDirectoryRestriction,
} from "../user/UserDirectoryRestriction";
import { ViewManager } from "../view-manager/ViewManager";
import { FilesystemHandler } from "./FilesystemHandler";
import {
  FilesystemHandles,
  type OpenedFilesystemFile,
  readOpenedFile,
} from "./FilesystemHandles";
import { FilesystemTransfer } from "./FilesystemTransfer";
import { FilesystemWatcher } from "./FilesystemWatcher";
import { VolumeManager } from "./VolumeManager";

interface FilesystemEvents {
  changed: { watchId: string; kind: FilesystemChangeKind };
}

const openFlags: Record<FilesystemOpenMode, number> = {
  read: constants.O_RDONLY | constants.O_NONBLOCK,
};
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
  private readonly handles: FilesystemHandles;
  private readonly stopHandleViewListener: () => void;
  private stopHandleAppListener?: () => void;

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
    this.handles = new FilesystemHandles(
      this.executionContext,
      (location, mode, retained) => this.openFile(location, mode, retained),
    );
    this.stopHandleViewListener = this.viewManager.on(
      "view-removed",
      ({ webContentsId }) => this.handles.closeOwner({ webContentsId }),
    );

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
    this.stopVolumeListener = this.volumes.on("changed", ({ volumes }) => {
      this.watcher.removeUnavailableVolumes(
        new Set(
          volumes
            .filter((volume) => volume.state === "ready")
            .map((volume) => volume.id),
        ),
      );
    });
  }

  /**
   * Get the base directory (user directory)
   */
  getBaseDir(): string {
    return this.baseDir;
  }

  connectLifecycle(processes: ProcessManager): void {
    this.stopHandleAppListener?.();
    const closeOwner = ({ appId }: { appId: string }) =>
      this.handles.closeOwner({ appId });
    const stop = processes.on("stopped", closeOwner);
    const exit = processes.on("exited", closeOwner);
    this.stopHandleAppListener = () => {
      stop();
      exit();
    };
  }

  open(
    location: FilesystemLocation,
    mode: FilesystemOpenMode = "read",
  ): Promise<FilesystemHandle> {
    return this.handles.open(location, mode);
  }

  close(handle: FilesystemHandle): Promise<void> {
    return this.handles.close(handle);
  }

  /** Release retained access for a session transition, or the whole runtime. */
  releaseHandles(sessionId?: string): Promise<void> {
    return this.handles.closeOwner({ sessionId });
  }

  /** Release open handles before draining operations which may be waiting to eject. */
  closeHandles(): Promise<void> {
    return this.handles.dispose();
  }

  private async openFile(
    location: FilesystemLocation,
    mode: FilesystemOpenMode,
    retained: boolean,
  ): Promise<OpenedFilesystemFile> {
    this.requirePrincipal();
    const access = this.volumes.acquire([location.volume], !retained);
    let file: fs.FileHandle | undefined;
    try {
      return await access.run(async () => {
        const target = await this.resolveTarget(location);
        file = await fs.open(target.hostPath, openFlags[mode]);
        if (!(await file.stat()).isFile())
          throw new Error("Filesystem source is not a regular file");
        await target.assertActive();
        const descriptor = file;
        return {
          use: (operation) =>
            access.run(async () => {
              await target.assertActive();
              const result = await operation(descriptor);
              await target.assertActive();
              return result;
            }),
          close: async () => {
            try {
              await descriptor.close();
            } finally {
              access.release();
            }
          },
        };
      });
    } catch (error) {
      try {
        await file?.close();
      } finally {
        access.release();
      }
      throw error;
    }
  }

  /**
   * Resolve a masked path (as seen by apps) to an absolute filesystem path.
   *
   * @param location - The volume and masked path (e.g., "/file.json" or "/Documents/notes.txt")
   * @returns The resolved absolute path (e.g., "/home/user/.eden/file.json")
   * @throws Error if the path attempts to escape the base directory
   */
  async resolvePath(location: FilesystemLocation): Promise<string> {
    return this.volumes.withVolumes([location.volume], async () => {
      return (await this.resolveTarget(location)).hostPath;
    });
  }

  prepareVolumeOperation<R>(
    ids: string[],
    run: (reporter: OperationReporter) => Promise<R>,
  ): OperationTask<R> {
    this.requirePrincipal();
    return this.volumes.prepareOperation(ids, run);
  }

  /** Hold access until the consumer finishes I/O at the resolved host path. */
  async withVolume<T>(
    location: FilesystemLocation,
    operation: (hostPath: string) => Promise<T>,
  ): Promise<T> {
    return this.volumes.withVolumes([location.volume], async () =>
      operation(await this.resolvePath(location)),
    );
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
    const rootPath = mounted?.rootPath ?? this.baseDir;
    const accessPath = mounted?.rootPath ?? this.getHomeAccessPath();
    const assertActive = async () => {
      await mounted?.assertActive();
    };
    await assertActive();
    const relativePath = address.path.replace(/^[\\/]+/, "");
    const hostPath = path.resolve(rootPath, relativePath);
    assertPathWithin(rootPath, hostPath, `Path '${address.path}'`);
    assertPathWithin(accessPath, hostPath, `Path '${address.path}'`);
    await assertExistingPathWithin(rootPath, hostPath);
    if (accessPath !== rootPath)
      await assertExistingPathWithin(accessPath, hostPath);
    await assertActive();
    return { hostPath, rootPath, accessPath, assertActive };
  }

  private assertNotRoot(target: {
    hostPath: string;
    rootPath: string;
    accessPath: string;
  }): void {
    if (target.hostPath === target.rootPath)
      throw new Error("Cannot delete, move, or replace a volume root");
    if (target.hostPath === target.accessPath)
      throw new Error("Cannot delete, move, or replace an access root");
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
    return this.volumes.withVolumes([volume], async () => {
      this.requirePrincipal();
      const mounted = this.volumes.getRoot(volume);
      await mounted?.assertActive();
      const rootPath = mounted?.rootPath ?? this.baseDir;
      const normalizedAbsolute = path.resolve(absolutePath);
      assertPathWithin(rootPath, normalizedAbsolute, `Path '${absolutePath}'`);
      const relativePath = path.relative(rootPath, normalizedAbsolute);
      const location = {
        volume,
        path: `/${relativePath.split(path.sep).join("/")}`,
      };
      await this.resolveTarget(location);
      return location;
    });
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

  /** Accessible starting directory; addresses remain relative to the volume root. */
  accessScope(volume: string): FilesystemLocation {
    this.requirePrincipal();
    this.volumes.get(volume);
    const accessPath = volume === "home" ? this.getHomeAccessPath() : undefined;
    const relativePath = accessPath
      ? path.relative(this.baseDir, accessPath)
      : "";
    return { volume, path: `/${relativePath.split(path.sep).join("/")}` };
  }

  private getHomeAccessPath(): string {
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

    const directoryRestriction = normalizeDirectoryRestriction(
      user.directoryRestriction,
    );
    if (!directoryRestriction) {
      return this.baseDir;
    }

    return resolveDirectoryRestriction(this.baseDir, directoryRestriction);
  }

  // =====================
  // Filesystem Operations
  // =====================

  /**
   * Read the contents of a file.
   */
  async readFile(
    targetPath: FilesystemSource,
    encoding: BufferEncoding = "utf-8",
  ): Promise<string> {
    return this.handles.use(targetPath, async (file) =>
      (await readOpenedFile(file)).toString(encoding),
    );
  }

  /**
   * Read the contents of a file without text encoding.
   */
  async readBinaryFile(targetPath: FilesystemSource): Promise<Uint8Array> {
    return this.handles.use(
      targetPath,
      async (file) => new Uint8Array(await readOpenedFile(file)),
    );
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
    return this.volumes.withVolumes([targetPath.volume], async () => {
      const target = await this.resolveTarget(targetPath, true);
      const fullPath = target.hostPath;
      await target.assertActive();
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await target.assertActive();
      await assertExistingPathWithin(target.rootPath, fullPath);
      if (target.accessPath !== target.rootPath)
        await assertExistingPathWithin(target.accessPath, fullPath);
      await target.assertActive();
      await fs.writeFile(fullPath, content, encoding);
      this.invalidateHostDirectory(path.dirname(fullPath));
    });
  }

  /**
   * Check if a file or directory exists.
   */
  async exists(targetPath: FilesystemLocation): Promise<boolean> {
    return this.volumes.withVolumes([targetPath.volume], async () => {
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
    });
  }

  /**
   * Create a directory and any necessary parent directories.
   */
  async mkdir(targetPath: FilesystemLocation): Promise<void> {
    return this.volumes.withVolumes([targetPath.volume], async () => {
      const target = await this.resolveTarget(targetPath, true);
      const fullPath = target.hostPath;
      await target.assertActive();
      await fs.mkdir(fullPath, { recursive: true });
      this.invalidateHostDirectory(path.dirname(fullPath));
    });
  }

  /**
   * List contents of a directory.
   */
  async readdir(targetPath: FilesystemLocation): Promise<string[]> {
    return this.volumes.withVolumes([targetPath.volume], async () => {
      const fullPath = await this.resolvePath(targetPath);
      return await fs.readdir(fullPath);
    });
  }

  /**
   * Get file or directory statistics.
   */
  async stat(targetPath: FilesystemSource): Promise<FileStats> {
    const stats =
      "handleId" in targetPath
        ? await this.handles.use(targetPath, (file) => file.stat())
        : await this.volumes.withVolumes([targetPath.volume], async () =>
            fs.stat(await this.resolvePath(targetPath)),
          );
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
    return this.volumes.withVolumes([location.volume], async () => {
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
    });
  }

  /**
   * Delete a file or directory.
   * For directories, removes recursively.
   */
  async delete(
    targetPath: FilesystemLocation,
    reporter?: OperationReporter,
  ): Promise<void> {
    reporter?.update("validating");
    return this.volumes.withVolumes([targetPath.volume], async () => {
      const target = await this.resolveTarget(targetPath, true);
      const fullPath = target.hostPath;

      this.assertNotRoot(target);

      // Check if it exists and get stats
      const stats = await fs.stat(fullPath);

      await target.assertActive();
      reporter?.update("deleting");
      if (stats.isDirectory()) {
        // Remove directory recursively
        await fs.rm(fullPath, { recursive: true, force: true });
      } else {
        // Remove file
        await fs.unlink(fullPath);
      }
      this.invalidateHostDirectory(path.dirname(fullPath));
    });
  }

  /**
   * Copy a file or directory to another location.
   */
  async copy(
    fromPath: FilesystemLocation,
    toPath: FilesystemLocation,
    overwrite: boolean = false,
    reporter?: OperationReporter,
  ): Promise<void> {
    reporter?.update("validating");
    return this.volumes.withVolumes(
      [fromPath.volume, toPath.volume],
      async () => {
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
          reporter,
        });
        this.invalidateHostDirectory(path.dirname(destination));
      },
    );
  }

  /**
   * Move or rename a file or directory.
   * Falls back to copy+delete when rename crosses filesystem boundaries.
   */
  async move(
    fromPath: FilesystemLocation,
    toPath: FilesystemLocation,
    overwrite: boolean = false,
    reporter?: OperationReporter,
  ): Promise<void> {
    reporter?.update("validating");
    return this.volumes.withVolumes(
      [fromPath.volume, toPath.volume],
      async () => {
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
          reporter,
        });
        this.invalidateHostDirectory(path.dirname(source));
        this.invalidateHostDirectory(path.dirname(destination));
      },
    );
  }

  async watchDirectory(
    targetPath: FilesystemLocation,
    callerWebContentsId: number | undefined,
  ): Promise<{ watchId: string }> {
    return this.volumes.withVolumes([targetPath.volume], async () => {
      const target = await this.resolveTarget(targetPath);
      if (!this.volumes.get(targetPath.volume).supportsWatch)
        throw new Error("Filesystem volume does not support watching");
      const hostPath = target.hostPath;
      const stats = await fs.stat(hostPath);
      await target.assertActive();
      if (!stats.isDirectory()) {
        throw new Error(`Path '${targetPath.path}' is not a directory`);
      }

      if (this.volumes.get(targetPath.volume).state !== "ready")
        throw new Error("Filesystem volume is being removed");
      return this.watcher.watch(
        hostPath,
        callerWebContentsId,
        targetPath.volume,
      );
    });
  }

  unwatch(watchId: string, callerWebContentsId: number | undefined): void {
    this.watcher.unwatch(watchId, callerWebContentsId);
  }

  private invalidateHostDirectory(hostPath: string): void {
    this.watcher.invalidate(hostPath);
  }

  override async dispose(): Promise<void> {
    this.stopHandleViewListener();
    this.stopHandleAppListener?.();
    this.stopVolumeListener();
    this.watcher.dispose();
    super.dispose();
    await this.closeHandles();
  }
}
