import * as fs from "fs/promises";
import * as path from "path";
import fg from "fast-glob";
import { EdenHandler, EdenNamespace } from "../ipc";

@EdenNamespace("fs")
export class FilesystemHandler {
  private baseDir: string;

  constructor(baseDir: string) {
    // Normalize baseDir to an absolute path to ensure proper path resolution
    this.baseDir = path.resolve(baseDir);
  }

  private resolvePath(targetPath: string): string {
    // Prevent directory traversal
    const safePath = path.normalize(targetPath).replace(/^(\.\.[\/\\])+/, "");
    // Remove leading slashes to ensure path.join works correctly
    const relativePath = safePath.replace(/^[\/\\]+/, "");
    const resolved = path.join(this.baseDir, relativePath);

    // Double check it's still inside baseDir
    if (!resolved.startsWith(this.baseDir)) {
      throw new Error(
        `Access denied: Path '${targetPath}' resolves to '${resolved}', which is outside of base directory '${this.baseDir}'`
      );
    }
    return resolved;
  }

  /**
   * Read the contents of a file.
   */
  @EdenHandler("read", { permission: "read" })
  async handleReadFile(args: {
    path: string;
    encoding?: BufferEncoding;
  }): Promise<string> {
    const { path: targetPath, encoding = "utf-8" } = args;
    const fullPath = this.resolvePath(targetPath);
    return await fs.readFile(fullPath, encoding);
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
    const fullPath = this.resolvePath(targetPath);

    // Ensure directory exists
    await fs.mkdir(path.dirname(fullPath), { recursive: true });

    await fs.writeFile(fullPath, content, encoding);
  }

  /**
   * Check if a file or directory exists.
   */
  @EdenHandler("exists", { permission: "read" })
  async handleExists(args: { path: string }): Promise<boolean> {
    const { path: targetPath } = args;
    try {
      const fullPath = this.resolvePath(targetPath);
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create a directory and any necessary parent directories.
   */
  @EdenHandler("mkdir", { permission: "write" })
  async handleMkdir(args: { path: string }): Promise<void> {
    const { path: targetPath } = args;
    const fullPath = this.resolvePath(targetPath);
    await fs.mkdir(fullPath, { recursive: true });
  }

  /**
   * List contents of a directory.
   */
  @EdenHandler("readdir", { permission: "read" })
  async handleReaddir(args: { path: string }): Promise<string[]> {
    const { path: targetPath } = args;
    const fullPath = this.resolvePath(targetPath);
    return await fs.readdir(fullPath);
  }

  /**
   * Get file or directory statistics.
   */
  @EdenHandler("stat", { permission: "read" })
  async handleStat(args: { path: string }): Promise<{
    isFile: boolean;
    isDirectory: boolean;
    size: number;
    mtime: Date;
  }> {
    const { path: targetPath } = args;
    const fullPath = this.resolvePath(targetPath);
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
  @EdenHandler("search", { permission: "read" })
  async handleSearch(args: {
    path: string;
    pattern: string;
    limit?: number;
  }): Promise<
    Array<{
      name: string;
      path: string;
      type: "file" | "folder";
    }>
  > {
    const { path: basePath, pattern, limit = 10 } = args;
    const fullPath = this.resolvePath(basePath);

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
      });

      const results = [];
      for (const entry of entries) {
        if (results.length >= limit) break;

        const entryPath = basePath === "/" ? `/${entry.path}` : `${basePath}/${entry.path}`;
        const isDirectory = entry.stats?.isDirectory() ?? false;

        results.push({
          name: path.basename(entry.path),
          path: entryPath,
          type: (isDirectory ? "folder" : "file") as "file" | "folder",
        });
      }

      return results;
    } catch (error) {
      console.error("Search error:", error);
      return [];
    }
  }

  /**
   * Delete a file or directory.
   * For directories, removes recursively.
   */
  @EdenHandler("delete", { permission: "write" })
  async handleDelete(args: { path: string }): Promise<void> {
    const { path: targetPath } = args;
    const fullPath = this.resolvePath(targetPath);

    // Check if it exists and get stats
    const stats = await fs.stat(fullPath);

    if (stats.isDirectory()) {
      // Remove directory recursively
      await fs.rm(fullPath, { recursive: true, force: true });
    } else {
      // Remove file
      await fs.unlink(fullPath);
    }
  }
}
