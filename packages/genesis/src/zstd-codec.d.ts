declare module "zstd-codec" {
  export interface ZstdSimple {
    compress(data: Uint8Array, compressionLevel?: number): Uint8Array;
    decompress(data: Uint8Array): Uint8Array;
  }

  export interface ZstdStreaming {
    decompressChunks(chunks: Uint8Array[]): Uint8Array;
  }

  export interface Zstd {
    Simple: new () => ZstdSimple;
    Streaming: new () => ZstdStreaming;
  }

  export const ZstdCodec: {
    run(callback: (zstd: Zstd) => void): void;
  };
}
