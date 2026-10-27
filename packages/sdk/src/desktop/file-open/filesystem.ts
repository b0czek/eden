import type { FilesystemLocation } from "@edenapp/types";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { WASMagic } from "wasmagic";
import { fromPromise } from "../../core/effects/io";
import { io } from "../../platform/filesystem/native-io";
import type { Filesystem } from "../../platform/filesystem/service";
import { log } from "../../platform/logging/logger";

import { normalizeMimeType } from "./handlers";

const MIME_DETECTION_BYTES = 8192;

/** Keep the volume lease through metadata/content I/O and defer the WASM load. */
export const createFileInspection = Effect.fn(function* (
  filesystem: Pick<Filesystem, "withVolume">,
) {
  const detector = yield* Effect.cachedWithTTL(
    fromPromise(() => WASMagic.create()),
    (exit) => (Exit.isSuccess(exit) ? Duration.infinity : Duration.zero),
  );
  const detectMimeType = Effect.fn(function* (fullPath: string) {
    return yield* Effect.gen(function* () {
      const handle = yield* io.open(fullPath);
      const buffer = Buffer.alloc(MIME_DETECTION_BYTES);
      const bytesRead = yield* handle.read(buffer, 0);
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
    inspect: (location: FilesystemLocation) =>
      filesystem.withVolume(location, (fullPath) =>
        Effect.gen(function* () {
          const stats = yield* io.stat(fullPath);
          const isDirectory = stats.isDirectory();
          return {
            isDirectory,
            mimeType: isDirectory ? undefined : yield* detectMimeType(fullPath),
          };
        }),
      ),
    isDirectory: (location: FilesystemLocation) =>
      filesystem.withVolume(location, (fullPath) =>
        io.stat(fullPath).pipe(Effect.map((stat) => stat.isDirectory())),
      ),
  };
});
