import * as fs from "node:fs/promises";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { WASMagic } from "wasmagic";
import { asError, fromPromise } from "../effects/io";
import type { Filesystem } from "../filesystem";
import { log } from "../logging";
import { FileMetadataFailed } from "./errors";
import { normalizeMimeType } from "./handlers";
import type { FileOpenFilesystem } from "./ports";

const MIME_DETECTION_BYTES = 8192;

/** Keep the volume lease through metadata/content I/O and defer the WASM load. */
export const createFileOpenFilesystem = Effect.fn(function* (
  filesystem: Pick<Filesystem, "withVolume">,
) {
  const detector = yield* Effect.cachedWithTTL(
    fromPromise(() => WASMagic.create()),
    (exit) => (Exit.isSuccess(exit) ? Duration.infinity : Duration.zero),
  );
  const detectMimeType = Effect.fn(function* (fullPath: string) {
    return yield* Effect.gen(function* () {
      const handle = yield* Effect.acquireRelease(
        fromPromise(() => fs.open(fullPath, "r")),
        (handle) => fromPromise(() => handle.close()).pipe(Effect.orDie),
      );
      const buffer = Buffer.alloc(MIME_DETECTION_BYTES);
      const { bytesRead } = yield* fromPromise(() =>
        handle.read(buffer, 0, buffer.length, 0),
      );
      if (bytesRead === 0) return undefined;
      const magic = yield* detector;
      return normalizeMimeType(magic.detect(buffer.subarray(0, bytesRead)));
    }).pipe(
      Effect.scoped,
      Effect.catch((error) =>
        Effect.sync(() => {
          log.warn(`Failed to detect MIME type for ${fullPath}:`, error);
          return undefined;
        }),
      ),
    );
  });
  return {
    inspect: (location) =>
      filesystem.withVolume(location, (fullPath) =>
        Effect.gen(function* () {
          const stats = yield* fromPromise(
            () => fs.stat(fullPath),
            (cause) =>
              new FileMetadataFailed({
                location: { ...location },
                cause,
                message: asError(cause).message,
              }),
          );
          const isDirectory = stats.isDirectory();
          return {
            isDirectory,
            mimeType: isDirectory ? undefined : yield* detectMimeType(fullPath),
          };
        }),
      ),
    isDirectory: (location) =>
      filesystem.withVolume(location, (fullPath) =>
        fromPromise(
          () => fs.stat(fullPath),
          (cause) =>
            new FileMetadataFailed({
              location: { ...location },
              cause,
              message: asError(cause).message,
            }),
        ).pipe(Effect.map((stat) => stat.isDirectory())),
      ),
  } satisfies FileOpenFilesystem;
});
