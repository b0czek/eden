/**
 * Compression abstraction layer
 * Makes it easy to switch between different compression libraries
 */

/**
 * Common interface for compression implementations
 */
export interface Compressor {
  /**
   * Initialize the compressor (async for libraries that need setup)
   */
  initialize(): Promise<void>;

  /**
   * Compress data
   * @param data - Data to compress
   * @param level - Compression level (1-22 for zstd)
   * @returns Compressed data
   */
  compress(data: Buffer, level: number): Promise<Buffer>;

  /**
   * Decompress data
   * @param data - Compressed data
   * @returns Decompressed data
   */
  decompress(data: Buffer): Promise<Buffer>;
}

/**
 * zstd-codec implementation (JavaScript/WASM)
 * - No native dependencies
 * - Cross-platform
 * - Good for distribution
 */
export class ZstdCodecCompressor implements Compressor {
  private zstd: any = null;

  async initialize(): Promise<void> {
    if (this.zstd) return;

    // Dynamic import to avoid loading until needed
    const { ZstdCodec } = await import('zstd-codec');

    return new Promise((resolve) => {
      ZstdCodec.run((zstd: any) => {
        this.zstd = zstd;
        resolve();
      });
    });
  }

  async compress(data: Buffer, level: number): Promise<Buffer> {
    if (!this.zstd) {
      throw new Error('Compressor not initialized. Call initialize() first.');
    }

    const simple = new this.zstd.Simple();
    const compressed = simple.compress(new Uint8Array(data), level);
    return Buffer.from(compressed);
  }

  async decompress(data: Buffer): Promise<Buffer> {
    if (!this.zstd) {
      throw new Error('Compressor not initialized. Call initialize() first.');
    }

    const simple = new this.zstd.Simple();
    const decompressed = simple.decompress(new Uint8Array(data));
    return Buffer.from(decompressed);
  }
}


/**
 * Default compressor implementation
 */
export const DEFAULT_COMPRESSOR: Compressor = new ZstdCodecCompressor();
