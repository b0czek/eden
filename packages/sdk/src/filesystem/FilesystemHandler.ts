import type {
  FileStats,
  FilesystemTransferArgs,
  SearchResult,
} from "@edenapp/types";
import { EdenHandler, EdenNamespace } from "../ipc";
import type { FilesystemManager } from "./FilesystemManager";

/**
 * FilesystemHandler - Thin IPC layer for filesystem operations.
 * All business logic lives in FilesystemManager.
 */
@EdenNamespace("fs")
export class FilesystemHandler {
  constructor(private fsManager: FilesystemManager) {}

  /**
   * Read the contents of a file.
   */
  @EdenHandler("read", { permission: "read" })
  async handleReadFile(args: {
    path: string;
    encoding?: string;
  }): Promise<string> {
    const { path: targetPath, encoding = "utf-8" } = args;
    return await this.fsManager.readFile(
      targetPath,
      encoding as BufferEncoding,
    );
  }

  /**
   * Read the raw contents of a file.
   */
  @EdenHandler("read-binary", { permission: "read" })
  async handleReadBinaryFile(args: { path: string }): Promise<Uint8Array> {
    return await this.fsManager.readBinaryFile(args.path);
  }

  /**
   * Write content to a file, creating directories if needed.
   */
  @EdenHandler("write", { permission: "write" })
  async handleWriteFile(args: {
    path: string;
    content: string;
    encoding?: string;
  }): Promise<void> {
    const { path: targetPath, content, encoding = "utf-8" } = args;
    await this.fsManager.writeFile(
      targetPath,
      content,
      encoding as BufferEncoding,
    );
  }

  /**
   * Write raw bytes to a file, creating directories if needed.
   */
  @EdenHandler("write-binary", { permission: "write" })
  async handleWriteBinaryFile(args: {
    path: string;
    content: Uint8Array;
  }): Promise<void> {
    if (!(args.content instanceof Uint8Array)) {
      throw new TypeError("Binary file content must be a Uint8Array");
    }
    await this.fsManager.writeBinaryFile(args.path, args.content);
  }

  /**
   * Check if a file or directory exists.
   */
  @EdenHandler("exists", { permission: "read" })
  async handleExists(args: { path: string }): Promise<boolean> {
    const { path: targetPath } = args;
    return await this.fsManager.exists(targetPath);
  }

  /**
   * Create a directory and any necessary parent directories.
   */
  @EdenHandler("mkdir", { permission: "write" })
  async handleMkdir(args: { path: string }): Promise<void> {
    const { path: targetPath } = args;
    await this.fsManager.mkdir(targetPath);
  }

  /**
   * List contents of a directory.
   */
  @EdenHandler("readdir", { permission: "read" })
  async handleReaddir(args: { path: string }): Promise<string[]> {
    const { path: targetPath } = args;
    return await this.fsManager.readdir(targetPath);
  }

  /**
   * Get file or directory statistics.
   */
  @EdenHandler("stat", { permission: "read" })
  async handleStat(args: { path: string }): Promise<FileStats> {
    const { path: targetPath } = args;
    return await this.fsManager.stat(targetPath);
  }

  @EdenHandler("watch", { permission: "read" })
  async handleWatch(args: {
    path: string;
    _callerWebContentsId?: number;
  }): Promise<{ watchId: string }> {
    return await this.fsManager.watchDirectory(
      args.path,
      args._callerWebContentsId,
    );
  }

  @EdenHandler("unwatch", { permission: "read" })
  handleUnwatch(args: {
    watchId: string;
    _callerWebContentsId?: number;
  }): void {
    this.fsManager.unwatch(args.watchId, args._callerWebContentsId);
  }

  /**
   * Resolve an Eden path to the underlying OS path.
   */
  @EdenHandler("resolve", { permission: "resolve" })
  async handleResolve(args: { path: string }): Promise<{ realPath: string }> {
    const { path: targetPath } = args;
    return { realPath: await this.fsManager.resolvePath(targetPath) };
  }

  /**
   * Search for files and directories using glob patterns.
   */
  @EdenHandler("search", { permission: "read" })
  async handleSearch(args: {
    path: string;
    pattern: string;
    limit?: number;
  }): Promise<SearchResult[]> {
    const { path: basePath, pattern, limit = 10 } = args;
    return await this.fsManager.search(basePath, pattern, limit);
  }

  /**
   * Delete a file or directory.
   * For directories, removes recursively.
   */
  @EdenHandler("delete", { permission: "write" })
  async handleDelete(args: { path: string }): Promise<void> {
    const { path: targetPath } = args;
    await this.fsManager.delete(targetPath);
  }

  /**
   * Copy a file or directory.
   * Directories are copied recursively.
   * Existing destinations are replaced only when overwrite is true.
   */
  @EdenHandler("cp", { permission: "write" })
  async handleCopy(args: FilesystemTransferArgs): Promise<void> {
    await this.fsManager.copy(args.from, args.to, args.overwrite ?? false);
  }

  /**
   * Move or rename a file or directory.
   * Existing destinations are replaced only when overwrite is true.
   */
  @EdenHandler("mv", { permission: "write" })
  async handleMove(args: FilesystemTransferArgs): Promise<void> {
    await this.fsManager.move(args.from, args.to, args.overwrite ?? false);
  }
}
