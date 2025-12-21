import { EdenHandler, EdenNamespace } from "../ipc";
import type { FilesystemManager } from "./FilesystemManager";
import type { FileStats, SearchResult } from "@edenapp/types";

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
    encoding?: BufferEncoding;
  }): Promise<string> {
    const { path: targetPath, encoding = "utf-8" } = args;
    return await this.fsManager.readFile(targetPath, encoding);
  }

  /**
   * Write content to a file, creating directories if needed.
   */
  @EdenHandler("write", { permission: "write" })
  async handleWriteFile(args: {
    path: string;
    content: string;
    encoding?: BufferEncoding;
  }): Promise<void> {
    const { path: targetPath, content, encoding = "utf-8" } = args;
    await this.fsManager.writeFile(targetPath, content, encoding);
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
}
