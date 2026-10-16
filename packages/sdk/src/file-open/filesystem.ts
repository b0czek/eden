import * as fs from "node:fs/promises";
import * as Effect from "effect/Effect";
import { WASMagic } from "wasmagic";
import type { FilesystemManager } from "../filesystem";
import { log } from "../logging";
import { normalizeMimeType } from "./handlers";
import type { FileOpenFilesystem } from "./ports";

const MIME_DETECTION_BYTES = 8192;
const asError = (error: unknown) =>
  error instanceof Error ? error : new Error(String(error));

/** Keep the volume lease through metadata/content I/O and defer the WASM load. */
export function createFileOpenFilesystem(
  filesystem: Pick<FilesystemManager, "withVolume">,
): FileOpenFilesystem {
  let detector: Promise<WASMagic> | undefined;

  async function detectMimeType(fullPath: string): Promise<string | undefined> {
    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(fullPath, "r");
      const buffer = Buffer.alloc(MIME_DETECTION_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead === 0) return undefined;
      detector ??= WASMagic.create();
      const magic = await detector;
      return normalizeMimeType(magic.detect(buffer.subarray(0, bytesRead)));
    } catch (error) {
      log.warn(`Failed to detect MIME type for ${fullPath}:`, error);
      return undefined;
    } finally {
      await handle?.close();
    }
  }

  return {
    inspect: (location) =>
      Effect.tryPromise({
        try: () =>
          filesystem.withVolume(location, async (fullPath) => {
            const stats = await fs.stat(fullPath);
            const isDirectory = stats.isDirectory();
            return {
              isDirectory,
              mimeType: isDirectory
                ? undefined
                : await detectMimeType(fullPath),
            };
          }),
        catch: asError,
      }).pipe(Effect.uninterruptible),
    isDirectory: (location) =>
      Effect.tryPromise({
        try: () =>
          filesystem.withVolume(location, async (fullPath) =>
            (await fs.stat(fullPath)).isDirectory(),
          ),
        catch: asError,
      }).pipe(Effect.uninterruptible),
  };
}
