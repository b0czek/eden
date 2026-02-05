/**
 * Compression abstraction layer
 * Makes it easy to switch between different compression libraries
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";

/**
 * Result of streaming compression
 */
export interface StreamCompressionResult {
  compressedData: Buffer;
  checksum: string;
}

/**
 * Common interface for compression implementations
 */
export interface Compressor {
  /**
   * Initialize the compressor (async for libraries that need setup)
   */
  initialize(): Promise<void>;

  /**
   * Compress a file using streaming to avoid loading entire file into memory
   * @param inputPath - Path to the file to compress
   * @param outputPath - Path to write the compressed data to
   * @param level - Compression level (1-22 for zstd)
   * @returns Checksum of the compressed data
   */
  compressFileStreaming(
    inputPath: string,
    outputPath: string,
    level: number,
  ): Promise<{ checksum: string }>;

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
    const { ZstdCodec } = await import("zstd-codec");

    return new Promise((resolve) => {
      ZstdCodec.run((zstd: any) => {
        this.zstd = zstd;
        resolve();
      });
    });
  }

  async compressFileStreaming(
    inputPath: string,
    outputPath: string,
    level: number,
  ): Promise<{ checksum: string }> {
    if (!this.zstd) {
      throw new Error("Compressor not initialized. Call initialize() first.");
    }

    return new Promise((resolve, reject) => {
      const hash = crypto.createHash("sha256");
      const simple = new this.zstd.Simple();
      const readStream = fs.createReadStream(inputPath, {
        highWaterMark: 64 * 1024, // 64KB chunks
      });

      const writeStream = fs.createWriteStream(outputPath);

      readStream.on("data", (chunk: string | Buffer) => {
        try {
          const chunkBuffer = Buffer.isBuffer(chunk)
            ? chunk
            : Buffer.from(chunk);
          const inputArray = new Uint8Array(chunkBuffer);

          // Compress chunk
          const compressedChunk = simple.compress(inputArray, level);

          if (compressedChunk && compressedChunk.length > 0) {
            // Write compressed chunk to file
            const bufferToWrite = Buffer.from(compressedChunk);
            writeStream.write(bufferToWrite);

            // Update checksum
            hash.update(bufferToWrite);
          }
        } catch (err) {
          readStream.destroy();
          writeStream.end();
          reject(err);
        }
      });

      readStream.on("end", () => {
        writeStream.end();
      });

      writeStream.on("finish", () => {
        const checksum = hash.digest("hex");
        resolve({ checksum });
      });

      readStream.on("error", (err) => {
        writeStream.end();
        reject(err);
      });

      writeStream.on("error", (err) => {
        readStream.destroy();
        reject(err);
      });
    });
  }

  async decompress(data: Buffer): Promise<Buffer> {
    if (!this.zstd) {
      throw new Error("Compressor not initialized. Call initialize() first.");
    }

    // Use decompressChunks to handle potential concatenated frames
    const streaming = new this.zstd.Streaming();
    const decompressed = streaming.decompressChunks([new Uint8Array(data)]);
    return Buffer.from(decompressed);
  }
}

/**
 * Default compressor implementation
 */
export const DEFAULT_COMPRESSOR: Compressor = new ZstdCodecCompressor();
