declare module "zstd-codec" {
  export interface ZstdSimple {
    compress(data: Uint8Array, compressionLevel?: number): Uint8Array;
    decompress(data: Uint8Array): Uint8Array;
  }

  export interface ZstdStream {
    compress(data: Uint8Array, compressionLevel?: number): Uint8Array;
    decompress(data: Uint8Array): Uint8Array;
  }

  export interface Zstd {
    Simple: ZstdSimple;
    Stream: ZstdStream;
  }

  export class ZstdCodec {
    static run(callback: (zstd: Zstd) => void): void;
  }
}
