import { randomUUID } from "node:crypto";
import {
  constants,
  createReadStream,
  createWriteStream,
  type Dirent,
  type MakeDirectoryOptions,
  type RmOptions,
  type Stats,
  watch,
} from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import type { FilesystemOpenMode } from "@edenapp/types";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import fg from "fast-glob";
import { fromPromise } from "../../core/effects/io";
import {
  type FilesystemIoFailed,
  type NativeFailureDetails,
  nativeFailure,
} from "./native-errors";

export interface NativeFile {
  readonly descriptor: number;
  stat(): Effect.Effect<Stats, FilesystemIoFailed>;
  read(
    buffer: Buffer,
    position: number,
  ): Effect.Effect<number, FilesystemIoFailed>;
  /** Read the complete file from position zero on every execution. */
  readAll(): Effect.Effect<Buffer, FilesystemIoFailed>;
}

/** The synchronous registry owner closes the watch on removal or disposal. */
export interface NativeWatch {
  close(): void;
}

/** Native work must settle before its descriptor, volume lease, or rollback releases. */
function fromNative<A>(
  operation: string,
  run: (signal: AbortSignal) => PromiseLike<A>,
  details: NativeFailureDetails = {},
  interruptible = false,
): Effect.Effect<A, FilesystemIoFailed> {
  const work = fromPromise(run, (cause) =>
    nativeFailure(operation, cause, details),
  );
  return interruptible ? work : Effect.uninterruptible(work);
}

const openFlags: Record<FilesystemOpenMode, number> = {
  read: constants.O_RDONLY | constants.O_NONBLOCK,
};

function open(
  hostPath: string,
  mode: FilesystemOpenMode = "read",
): Effect.Effect<NativeFile, FilesystemIoFailed, Scope.Scope> {
  return Effect.map(
    Effect.acquireRelease(
      fromNative("open", () => fs.open(hostPath, openFlags[mode])),
      (file) => fromNative("close", () => file.close()).pipe(Effect.orDie),
    ),
    (file): NativeFile => {
      const details = { path: hostPath, descriptor: file.fd };
      // Reads can stop between chunks; an in-flight syscall still drains.
      const read = (buffer: Buffer, position: number) =>
        fromNative(
          "read",
          () => file.read(buffer, 0, buffer.length, position),
          details,
          true,
        ).pipe(Effect.map(({ bytesRead }) => bytesRead));
      return {
        descriptor: file.fd,
        stat: () => fromNative("stat", () => file.stat(), details),
        read,
        readAll: Effect.fn(function* () {
          const chunks: Buffer[] = [];
          let position = 0;
          while (true) {
            const buffer = Buffer.allocUnsafe(64 * 1024);
            const bytesRead = yield* read(buffer, position);
            if (bytesRead === 0) return Buffer.concat(chunks, position);
            chunks.push(buffer.subarray(0, bytesRead));
            position += bytesRead;
          }
        }),
      };
    },
  );
}

export interface NativeCopyOptions<E = never> {
  checkAccess?: () => Effect.Effect<void, E>;
  onBytes?: (bytes: number) => void;
}

/** Copies into a fresh destination; callers prepare its parent and own rollback. */
const copy = Effect.fn(function* <E = never>(
  source: string,
  destination: string,
  options: NativeCopyOptions<E> = {},
): Effect.fn.Return<void, FilesystemIoFailed | E> {
  yield* options.checkAccess?.() ?? Effect.void;
  const stats = yield* io.lstat(source);
  if (stats.isDirectory()) {
    yield* io.mkdir(destination, { recursive: false });
    for (const name of yield* io.readdir(source)) {
      yield* copy(
        path.join(source, name),
        path.join(destination, name),
        options,
      );
    }
    yield* io.chmod(destination, stats.mode);
  } else if (stats.isFile()) {
    yield* copyFile(source, destination, stats.mode, options.onBytes);
    yield* io.chmod(destination, stats.mode);
  } else {
    // Native copy preserves link text and rejects unsupported special files.
    yield* fromNative("copy", () =>
      fs.cp(source, destination, {
        verbatimSymlinks: true,
        errorOnExist: true,
        force: false,
      }),
    );
  }
  yield* options.checkAccess?.() ?? Effect.void;
});

function copyFile(
  source: string,
  destination: string,
  mode: number,
  onBytes?: (bytes: number) => void,
): Effect.Effect<void, FilesystemIoFailed> {
  return Effect.suspend(() => {
    let progressFailed = false;
    let progressDefect: unknown;
    return fromNative(
      "copy",
      (signal) =>
        pipeline(
          createReadStream(source, { highWaterMark: 1024 * 1024 }),
          async function* (chunks) {
            for await (const chunk of chunks) {
              yield chunk;
              try {
                onBytes?.(chunk.length);
              } catch (cause) {
                progressFailed = true;
                progressDefect = cause;
                throw cause;
              }
            }
          },
          createWriteStream(destination, { flags: "wx", mode }),
          { signal },
        ),
      {},
      true,
    ).pipe(
      Effect.catch((error) =>
        progressFailed ? Effect.die(progressDefect) : Effect.fail(error),
      ),
    );
  });
}

function watchDirectory(
  hostPath: string,
  onChange: (eventType: "rename" | "change", filename: string | null) => void,
  onError: (error: FilesystemIoFailed) => void,
  options: { persistent?: boolean } = { persistent: false },
): Effect.Effect<NativeWatch, FilesystemIoFailed> {
  return Effect.try({
    try: () => {
      const watcher = watch(hostPath, options, onChange);
      watcher.on("error", (cause) =>
        onError(nativeFailure("watch", cause, { path: hostPath })),
      );
      return { close: () => watcher.close() };
    },
    catch: (cause) =>
      nativeFailure("watch", cause, {
        path: hostPath,
        message: `Cannot watch filesystem path '${hostPath}'`,
      }),
  });
}

function readFile(hostPath: string): Effect.Effect<Buffer, FilesystemIoFailed>;
function readFile(
  hostPath: string,
  encoding: BufferEncoding,
): Effect.Effect<string, FilesystemIoFailed>;
function readFile(
  hostPath: string,
  encoding?: BufferEncoding,
): Effect.Effect<Buffer | string, FilesystemIoFailed> {
  return fromNative("readFile", () => fs.readFile(hostPath, encoding));
}

/** Replace through a sibling file; callers own serialization and parent creation. */
const writeFileAtomic = Effect.fn(function* (
  hostPath: string,
  content: string | Uint8Array,
  encoding?: BufferEncoding,
) {
  const temporary = yield* Effect.acquireRelease(
    Effect.sync(() => `${hostPath}.${randomUUID()}.tmp`),
    (file) =>
      fromNative("rm", () => fs.rm(file, { force: true })).pipe(Effect.orDie),
  );
  yield* fromNative("writeFile", () =>
    fs.writeFile(temporary, content, encoding),
  );
  yield* fromNative("rename", () => fs.rename(temporary, hostPath), {
    path: hostPath,
  });
}, Effect.scoped);

function readdir(hostPath: string): Effect.Effect<string[], FilesystemIoFailed>;
function readdir(
  hostPath: string,
  options: { withFileTypes: true },
): Effect.Effect<Dirent[], FilesystemIoFailed>;
function readdir(
  hostPath: string,
  options?: { withFileTypes: true },
): Effect.Effect<string[] | Dirent[], FilesystemIoFailed> {
  return fromNative<string[] | Dirent[]>("readdir", () =>
    options?.withFileTypes
      ? fs.readdir(hostPath, { withFileTypes: true })
      : fs.readdir(hostPath),
  );
}

function glob(
  pattern: string,
  options: fg.Options & { stats: true },
): Effect.Effect<fg.Entry[], FilesystemIoFailed> {
  return fromNative("glob", () => fg(pattern, options));
}

/** Shared host filesystem boundary. Domains own policy and adapt native failures. */
export const io = {
  open,
  stat: (hostPath: string) => fromNative("stat", () => fs.stat(hostPath)),
  lstat: (hostPath: string) => fromNative("lstat", () => fs.lstat(hostPath)),
  realpath: (hostPath: string) =>
    fromNative("realpath", () => fs.realpath(hostPath)),
  access: (hostPath: string) => fromNative("access", () => fs.access(hostPath)),
  mkdir: (
    hostPath: string,
    options: MakeDirectoryOptions = { recursive: true },
  ) =>
    fromNative("mkdir", () => fs.mkdir(hostPath, options)).pipe(Effect.asVoid),
  readFile,
  writeFile: (
    hostPath: string,
    content: string | Uint8Array,
    encoding?: BufferEncoding,
  ) => fromNative("writeFile", () => fs.writeFile(hostPath, content, encoding)),
  writeFileAtomic,
  readdir,
  rename: (source: string, destination: string) =>
    fromNative("rename", () => fs.rename(source, destination)),
  rm: (hostPath: string, options: RmOptions) =>
    fromNative("rm", () => fs.rm(hostPath, options)),
  delete: (hostPath: string, directory: boolean) =>
    fromNative("delete", () =>
      directory
        ? fs.rm(hostPath, { recursive: true, force: true })
        : fs.unlink(hostPath),
    ),
  chmod: (hostPath: string, mode: number) =>
    fromNative("chmod", () => fs.chmod(hostPath, mode)),
  glob,
  copy,
  watch: watchDirectory,
};
