import * as fs from "fs/promises";
import * as path from "path";
import { EdenHandler, EdenNamespace } from "../ipc";

@EdenNamespace("fs")
export class FilesystemHandler {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  private resolvePath(targetPath: string): string {
    // Prevent directory traversal
    const safePath = path.normalize(targetPath).replace(/^(\.\.[\/\\])+/, "");
    const resolved = path.join(this.baseDir, safePath);

    // Double check it's still inside baseDir
    if (!resolved.startsWith(this.baseDir)) {
      throw new Error(
        `Access denied: Path '${targetPath}' resolves to '${resolved}', which is outside of base directory '${this.baseDir}'`
      );
    }
    return resolved;
  }

  @EdenHandler("read")
  async handleReadFile(args: {
    path: string;
    encoding?: BufferEncoding;
  }): Promise<string> {
    const { path: targetPath, encoding = "utf-8" } = args;
    const fullPath = this.resolvePath(targetPath);
    return await fs.readFile(fullPath, encoding);
  }

  @EdenHandler("write")
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

  @EdenHandler("exists")
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

  @EdenHandler("mkdir")
  async handleMkdir(args: { path: string }): Promise<void> {
    const { path: targetPath } = args;
    const fullPath = this.resolvePath(targetPath);
    await fs.mkdir(fullPath, { recursive: true });
  }

  @EdenHandler("readdir")
  async handleReaddir(args: { path: string }): Promise<string[]> {
    const { path: targetPath } = args;
    const fullPath = this.resolvePath(targetPath);
    return await fs.readdir(fullPath);
  }

  @EdenHandler("stat")
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
}
