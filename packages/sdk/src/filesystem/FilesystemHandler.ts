import type {
  FileStats,
  FilesystemLocation,
  FilesystemTransferArgs,
  FilesystemVolume,
  SearchResult,
} from "@edenapp/types";
import type { OperationTask } from "../operations/OperationTask";
import * as v from "valibot";
import { EdenHandler, EdenNamespace } from "../ipc";
import {
  filesystemLocationArgsSchema,
  filesystemLocationSchema,
} from "./FilesystemLocationSchema";
import type { FilesystemManager } from "./FilesystemManager";

const encoding = v.optional(
  v.picklist([
    "ascii",
    "utf8",
    "utf-8",
    "utf16le",
    "utf-16le",
    "ucs2",
    "ucs-2",
    "base64",
    "base64url",
    "latin1",
    "binary",
    "hex",
  ]),
  "utf-8",
);
const readArgs = v.object({ location: filesystemLocationSchema, encoding });
const writeArgs = v.object({
  location: filesystemLocationSchema,
  content: v.string(),
  encoding,
});
const writeBinaryArgs = v.object({
  location: filesystemLocationSchema,
  content: v.instance(Uint8Array, "Binary file content must be a Uint8Array"),
});
const watchArgs = v.object({
  location: filesystemLocationSchema,
  _callerWebContentsId: v.optional(v.number()),
});
const unwatchArgs = v.object({
  watchId: v.string(),
  _callerWebContentsId: v.optional(v.number()),
});
const searchArgs = v.object({
  location: filesystemLocationSchema,
  pattern: v.string(),
  limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0)), 10),
});
const volumeArgs = v.object({ volume: v.pipe(v.string(), v.nonEmpty()) });
const transferArgs = v.object({
  from: filesystemLocationSchema,
  to: filesystemLocationSchema,
  overwrite: v.optional(v.boolean(), false),
});

/**
 * FilesystemHandler - Thin IPC layer for filesystem operations.
 * All business logic lives in FilesystemManager.
 */
@EdenNamespace("fs")
export class FilesystemHandler {
  constructor(private fsManager: FilesystemManager) {}

  @EdenHandler("volumes", { permission: "read" })
  handleVolumes(_args: Record<string, never>): FilesystemVolume[] {
    return this.fsManager.listVolumes();
  }

  /** Safely eject a device after draining admitted volume I/O. */
  @EdenHandler("eject", { permission: "eject", mode: "operation" })
  handleEject(args: { volume: string }): OperationTask<void> {
    const { volume } = v.parse(volumeArgs, args);
    return this.fsManager.prepareEjectVolume(volume);
  }

  /**
   * Read the contents of a file.
   */
  @EdenHandler("read", { permission: "read" })
  async handleReadFile(args: {
    location: FilesystemLocation;
    encoding?: string;
  }): Promise<string> {
    const { location, encoding } = v.parse(readArgs, args);
    return await this.fsManager.readFile(location, encoding);
  }

  /**
   * Read the raw contents of a file.
   */
  @EdenHandler("read-binary", { permission: "read" })
  async handleReadBinaryFile(args: {
    location: FilesystemLocation;
  }): Promise<Uint8Array> {
    const { location } = v.parse(filesystemLocationArgsSchema, args);
    return await this.fsManager.readBinaryFile(location);
  }

  /**
   * Write content to a file, creating directories if needed.
   */
  @EdenHandler("write", { permission: "write" })
  async handleWriteFile(args: {
    location: FilesystemLocation;
    content: string;
    encoding?: string;
  }): Promise<void> {
    const { location, content, encoding } = v.parse(writeArgs, args);
    await this.fsManager.writeFile(location, content, encoding);
  }

  /**
   * Write raw bytes to a file, creating directories if needed.
   */
  @EdenHandler("write-binary", { permission: "write" })
  async handleWriteBinaryFile(args: {
    location: FilesystemLocation;
    content: Uint8Array;
  }): Promise<void> {
    const { location, content } = v.parse(writeBinaryArgs, args);
    await this.fsManager.writeBinaryFile(location, content);
  }

  /**
   * Check if a file or directory exists.
   */
  @EdenHandler("exists", { permission: "read" })
  async handleExists(args: { location: FilesystemLocation }): Promise<boolean> {
    const { location } = v.parse(filesystemLocationArgsSchema, args);
    return await this.fsManager.exists(location);
  }

  /**
   * Create a directory and any necessary parent directories.
   */
  @EdenHandler("mkdir", { permission: "write" })
  async handleMkdir(args: { location: FilesystemLocation }): Promise<void> {
    const { location } = v.parse(filesystemLocationArgsSchema, args);
    await this.fsManager.mkdir(location);
  }

  /**
   * List contents of a directory.
   */
  @EdenHandler("readdir", { permission: "read" })
  async handleReaddir(args: {
    location: FilesystemLocation;
  }): Promise<string[]> {
    const { location } = v.parse(filesystemLocationArgsSchema, args);
    return await this.fsManager.readdir(location);
  }

  /**
   * Get file or directory statistics.
   */
  @EdenHandler("stat", { permission: "read" })
  async handleStat(args: { location: FilesystemLocation }): Promise<FileStats> {
    const { location } = v.parse(filesystemLocationArgsSchema, args);
    return await this.fsManager.stat(location);
  }

  @EdenHandler("watch", { permission: "read" })
  async handleWatch(args: {
    location: FilesystemLocation;
    _callerWebContentsId?: number;
  }): Promise<{ watchId: string }> {
    const { location, _callerWebContentsId } = v.parse(watchArgs, args);
    return await this.fsManager.watchDirectory(location, _callerWebContentsId);
  }

  @EdenHandler("unwatch", { permission: "read" })
  handleUnwatch(args: {
    watchId: string;
    _callerWebContentsId?: number;
  }): void {
    const { watchId, _callerWebContentsId } = v.parse(unwatchArgs, args);
    this.fsManager.unwatch(watchId, _callerWebContentsId);
  }

  /**
   * Resolve an Eden path to the underlying OS path.
   */
  @EdenHandler("resolve", { permission: "resolve" })
  async handleResolve(args: {
    location: FilesystemLocation;
  }): Promise<{ realPath: string }> {
    const { location } = v.parse(filesystemLocationArgsSchema, args);
    return { realPath: await this.fsManager.resolvePath(location) };
  }

  /**
   * Search for files and directories using glob patterns.
   */
  @EdenHandler("search", { permission: "read" })
  async handleSearch(args: {
    location: FilesystemLocation;
    pattern: string;
    limit?: number;
  }): Promise<SearchResult[]> {
    const { location, pattern, limit } = v.parse(searchArgs, args);
    return await this.fsManager.search(location, pattern, limit);
  }

  /**
   * Delete a file or directory.
   * For directories, removes recursively.
   */
  @EdenHandler("delete", { permission: "write", mode: "operation" })
  handleDelete(args: { location: FilesystemLocation }): OperationTask<void> {
    const { location } = v.parse(filesystemLocationArgsSchema, args);
    return this.fsManager.prepareVolumeOperation(
      [location.volume],
      (reporter) => this.fsManager.delete(location, reporter),
    );
  }

  /**
   * Copy a file or directory.
   * Directories are copied recursively.
   * Existing destinations are replaced only when overwrite is true.
   */
  @EdenHandler("cp", { permission: "write", mode: "operation" })
  handleCopy(args: FilesystemTransferArgs): OperationTask<void> {
    const { from, to, overwrite } = v.parse(transferArgs, args);
    return this.fsManager.prepareVolumeOperation(
      [from.volume, to.volume],
      (reporter) => this.fsManager.copy(from, to, overwrite, reporter),
    );
  }

  /**
   * Move or rename a file or directory.
   * Existing destinations are replaced only when overwrite is true.
   */
  @EdenHandler("mv", { permission: "write", mode: "operation" })
  handleMove(args: FilesystemTransferArgs): OperationTask<void> {
    const { from, to, overwrite } = v.parse(transferArgs, args);
    return this.fsManager.prepareVolumeOperation(
      [from.volume, to.volume],
      (reporter) => this.fsManager.move(from, to, overwrite, reporter),
    );
  }
}
