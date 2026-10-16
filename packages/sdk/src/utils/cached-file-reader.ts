import * as fs from "node:fs";
import * as Effect from "effect/Effect";
import { fromPromise } from "../effects/io";

export function createCachedFileReader() {
  let cache: Map<string, string> = new Map();

  function read(filePath: string, encoding: BufferEncoding = "utf-8"): string {
    const cacheKey = `${filePath}:${encoding}`;

    if (cache.has(cacheKey)) {
      const cached = cache.get(cacheKey);
      if (cached !== undefined) {
        return cached;
      }
    }

    const content = fs.readFileSync(filePath, encoding);
    cache.set(cacheKey, content);

    return content;
  }
  const readAsync = Effect.fn(function* readAsync(
    filePath: string,
    encoding: BufferEncoding = "utf-8",
  ): Effect.fn.Return<string, Error> {
    const cacheKey = `${filePath}:${encoding}`;

    if (cache.has(cacheKey)) {
      const cached = cache.get(cacheKey);
      if (cached !== undefined) {
        return cached;
      }
    }

    const content = yield* fromPromise(() =>
      fs.promises.readFile(filePath, encoding),
    );
    cache.set(cacheKey, content);

    return content;
  });
  function flushCache(): void {
    cache.clear();
  }
  function flushFile(
    filePath: string,
    encoding: BufferEncoding = "utf-8",
  ): void {
    const cacheKey = `${filePath}:${encoding}`;
    cache.delete(cacheKey);
  }
  function isCached(
    filePath: string,
    encoding: BufferEncoding = "utf-8",
  ): boolean {
    const cacheKey = `${filePath}:${encoding}`;
    return cache.has(cacheKey);
  }
  function getCacheSize(): number {
    return cache.size;
  }
  return { read, readAsync, flushCache, flushFile, isCached, getCacheSize };
}
export type CachedFileReader = ReturnType<typeof createCachedFileReader>;
