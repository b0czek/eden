import * as fs from 'fs';

/**
 * Cached file reader for non-changing files.
 * Reads from filesystem on first access, then serves from cache.
 */
class CachedFileReader {
  private cache: Map<string, string> = new Map();

  /**
   * Reads a file from cache if available, otherwise reads from filesystem and caches the result.
   * @param filePath - Absolute path to the file to read
   * @param encoding - File encoding (default: 'utf-8')
   * @returns The file contents as a string
   */
  read(filePath: string, encoding: BufferEncoding = 'utf-8'): string {
    const cacheKey = `${filePath}:${encoding}`;
    
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const content = fs.readFileSync(filePath, encoding);
    this.cache.set(cacheKey, content);
    
    return content;
  }

  /**
   * Asynchronously reads a file from cache if available, otherwise reads from filesystem and caches the result.
   * @param filePath - Absolute path to the file to read
   * @param encoding - File encoding (default: 'utf-8')
   * @returns Promise resolving to the file contents as a string
   */
  async readAsync(filePath: string, encoding: BufferEncoding = 'utf-8'): Promise<string> {
    const cacheKey = `${filePath}:${encoding}`;
    
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const content = await fs.promises.readFile(filePath, encoding);
    this.cache.set(cacheKey, content);
    
    return content;
  }

  /**
   * Flushes the entire cache.
   */
  flushCache(): void {
    this.cache.clear();
  }

  /**
   * Flushes a specific file from the cache.
   * @param filePath - Absolute path to the file to flush
   * @param encoding - File encoding (default: 'utf-8')
   */
  flushFile(filePath: string, encoding: BufferEncoding = 'utf-8'): void {
    const cacheKey = `${filePath}:${encoding}`;
    this.cache.delete(cacheKey);
  }

  /**
   * Checks if a file is cached.
   * @param filePath - Absolute path to the file
   * @param encoding - File encoding (default: 'utf-8')
   * @returns true if the file is cached, false otherwise
   */
  isCached(filePath: string, encoding: BufferEncoding = 'utf-8'): boolean {
    const cacheKey = `${filePath}:${encoding}`;
    return this.cache.has(cacheKey);
  }

  /**
   * Gets the number of cached files.
   * @returns The number of files currently in cache
   */
  getCacheSize(): number {
    return this.cache.size;
  }
}

// Export singleton instance for convenience
export const cachedFileReader = new CachedFileReader();

// Export class for creating custom instances if needed
export { CachedFileReader };
