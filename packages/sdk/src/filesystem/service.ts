import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  FileStats,
  FilesystemChangeKind,
  FilesystemHandle,
  FilesystemLocation,
  FilesystemOpenMode,
  FilesystemSource,
  SearchResult,
} from "@edenapp/types";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FiberSet from "effect/FiberSet";
import * as Layer from "effect/Layer";
import fg from "fast-glob";
import type { TargetedNotification } from "../controllers/events";
import { fromPromise } from "../effects/io";
import type { Event } from "../events/event";
import { listen, scopedEvent } from "../events/scoped";
import { ExecutionContext } from "../execution/context";
import { log } from "../logging";
import type { OperationReporter, OperationTask } from "../operations/task";
import { UserDirectory } from "../runtime/inputs";
import {
  assertExistingPathWithin,
  assertPathWithin,
  normalizeDirectoryRestriction,
  resolveDirectoryRestriction,
} from "../user/directory-restriction";
import { DirectoryRestrictionIoError } from "../user/errors";
import {
  accessRejection,
  FilesystemAccessDenied,
  type FilesystemFileError,
  type FilesystemHandleRejected,
  FilesystemIoFailed,
  type FilesystemPathError,
  type FilesystemTransferError,
  type FilesystemWatchError,
  FilesystemWatchRejected,
  watchRejection,
} from "./errors";
import {
  createFileHandles,
  type OpenedFilesystemFile,
  readOpenedFile,
} from "./file-handles";
import { FilesystemViews } from "./ports";
import { createFileTransfers } from "./transfers";
import type { VolumeUnavailable } from "./volumes/errors";
import type { VolumeRoot } from "./volumes/service";
import { Volumes } from "./volumes/service";
import { createFilesystemWatches } from "./watches";

export interface Filesystem {
  getBaseDir: () => string;
  changed: Event<
    TargetedNotification<{ watchId: string; kind: FilesystemChangeKind }>
  >;
  /** Synchronously throws FilesystemAccessDenied or VolumeUnavailable before admission. */
  accessScope: (volume: string) => FilesystemLocation;
  resolvePath: (
    location: FilesystemLocation,
  ) => Effect.Effect<string, FilesystemPathError>;
  /** Synchronously reserves volumes; throws FilesystemAccessDenied or VolumeUnavailable. */
  prepareVolumeOperation: <R, E>(
    ids: string[],
    run: (reporter: OperationReporter) => Effect.Effect<R, E>,
  ) => OperationTask<R, E | VolumeUnavailable>;
  withVolume: <A, E, R>(
    location: FilesystemLocation,
    operation: (hostPath: string) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | FilesystemPathError, R>;
  toMaskedPath: (
    absolutePath: string,
    volume: string,
  ) => Effect.Effect<{ volume: string; path: string }, FilesystemPathError>;
  isPathAllowed: (location: FilesystemLocation) => Effect.Effect<boolean>;
  readFile: (
    source: FilesystemSource,
    encoding?: BufferEncoding,
  ) => Effect.Effect<string, FilesystemFileError>;
  readBinaryFile: (
    source: FilesystemSource,
  ) => Effect.Effect<Uint8Array<ArrayBuffer>, FilesystemFileError>;
  writeFile: (
    location: FilesystemLocation,
    content: string,
    encoding?: BufferEncoding,
  ) => Effect.Effect<void, FilesystemPathError>;
  writeBinaryFile: (
    location: FilesystemLocation,
    content: Uint8Array,
  ) => Effect.Effect<void, FilesystemPathError>;
  exists: (
    location: FilesystemLocation,
  ) => Effect.Effect<boolean, FilesystemPathError>;
  mkdir: (
    location: FilesystemLocation,
  ) => Effect.Effect<void, FilesystemPathError>;
  readdir: (
    location: FilesystemLocation,
  ) => Effect.Effect<string[], FilesystemPathError>;
  stat: (
    source: FilesystemSource,
  ) => Effect.Effect<FileStats, FilesystemFileError>;
  search: (
    location: FilesystemLocation,
    pattern: string,
    limit?: number,
  ) => Effect.Effect<SearchResult[], FilesystemPathError>;
  delete: (
    location: FilesystemLocation,
    reporter?: OperationReporter,
  ) => Effect.Effect<void, FilesystemPathError>;
  copy: (
    from: FilesystemLocation,
    to: FilesystemLocation,
    overwrite?: boolean,
    reporter?: OperationReporter,
  ) => Effect.Effect<void, FilesystemTransferError>;
  move: (
    from: FilesystemLocation,
    to: FilesystemLocation,
    overwrite?: boolean,
    reporter?: OperationReporter,
  ) => Effect.Effect<void, FilesystemTransferError>;
  watchDirectory: (
    location: FilesystemLocation,
    webContentsId: number | undefined,
  ) => Effect.Effect<{ watchId: string }, FilesystemWatchError>;
  /** Synchronously throws FilesystemWatchRejected for a missing or foreign watch. */
  unwatch: (watchId: string, callerWebContentsId: number | undefined) => void;
  open: (
    location: FilesystemLocation,
    mode?: "read" | undefined,
  ) => Effect.Effect<FilesystemHandle, FilesystemFileError>;
  close: (
    handle: FilesystemHandle,
  ) => Effect.Effect<void, FilesystemHandleRejected>;
  closeOwner: (owner: {
    appId?: string;
    webContentsId?: number;
    sessionId?: string;
  }) => Effect.Effect<void>;
  releaseHandles: (sessionId?: string) => Effect.Effect<void>;
  closeHandles: () => Effect.Effect<void>;
}

export const Filesystem = Context.Service<"eden/Filesystem", Filesystem>(
  "eden/Filesystem",
);

const openFlags: Record<FilesystemOpenMode, number> = {
  read: constants.O_RDONLY | constants.O_NONBLOCK,
};
const io = <A>(operation: string, run: () => Promise<A>) =>
  fromPromise(
    run,
    (cause) =>
      new FilesystemIoFailed({
        operation,
        path: (cause as NodeJS.ErrnoException)?.path,
        cause,
        message: `Filesystem ${operation} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  ).pipe(Effect.uninterruptible);

// This dependency owns sandbox path validation; translate its failures here.
const assertExistingWithin = (rootPath: string, hostPath: string) =>
  assertExistingPathWithin(rootPath, hostPath).pipe(
    Effect.mapError((cause) =>
      cause instanceof DirectoryRestrictionIoError
        ? new FilesystemIoFailed({
            operation: "resolve",
            path: hostPath,
            cause: cause.cause,
            message: cause.message,
          })
        : new FilesystemAccessDenied({
            path: hostPath,
            cause,
            message: cause.message,
          }),
    ),
  );
function assertWithin(rootPath: string, hostPath: string, label: string): void {
  try {
    assertPathWithin(rootPath, hostPath, label);
  } catch (cause) {
    throw new FilesystemAccessDenied({
      path: hostPath,
      cause,
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

export const FilesystemLive = Layer.effect(
  Filesystem,
  Effect.gen(function* () {
    const inputBaseDir = yield* UserDirectory;
    const executionContext = yield* ExecutionContext;
    const views = yield* FilesystemViews;
    const volumes = yield* Volumes;
    const baseDir = path.resolve(inputBaseDir);
    const changed =
      yield* scopedEvent<
        TargetedNotification<{ watchId: string; kind: FilesystemChangeKind }>
      >();
    const transfer = createFileTransfers();

    function requirePrincipal(): void {
      const principal = executionContext.getPrincipal();
      if (principal?.kind !== "user" && principal?.kind !== "system")
        throw new FilesystemAccessDenied({
          message: "Caller has no filesystem execution principal",
        });
    }
    function getHomeAccessPath(): string {
      const principal = executionContext.getPrincipal();
      if (principal?.kind === "system") return baseDir;
      if (principal?.kind !== "user")
        throw new FilesystemAccessDenied({
          message: "Caller has no filesystem execution principal",
        });
      const user = principal.profile;
      if (user.role === "vendor") return baseDir;
      let restriction: string | undefined;
      try {
        restriction = normalizeDirectoryRestriction(user.directoryRestriction);
      } catch (cause) {
        throw new FilesystemAccessDenied({
          cause,
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
      return restriction
        ? resolveDirectoryRestriction(baseDir, restriction)
        : baseDir;
    }
    const resolveTargetNode = Effect.fn(function* (
      address: FilesystemLocation,
      write: boolean,
      mounted: VolumeRoot | undefined,
    ) {
      const target = yield* Effect.try({
        try: () => {
          requirePrincipal();
          const info = volumes.get(address.volume);
          if (write && info.readOnly)
            throw new FilesystemAccessDenied({
              path: address.path,
              message: `Filesystem volume '${address.volume}' is read-only`,
            });
          const rootPath = mounted?.rootPath ?? baseDir;
          const accessPath = mounted?.rootPath ?? getHomeAccessPath();
          const hostPath = path.resolve(
            rootPath,
            address.path.replace(/^[\\/]+/, ""),
          );
          assertWithin(rootPath, hostPath, `Path '${address.path}'`);
          assertWithin(accessPath, hostPath, `Path '${address.path}'`);
          return { rootPath, accessPath, hostPath };
        },
        catch: accessRejection,
      });
      const assertActive = () => mounted?.assertActive() ?? Effect.void;
      yield* assertActive();
      yield* assertExistingWithin(target.rootPath, target.hostPath);
      if (target.accessPath !== target.rootPath)
        yield* assertExistingWithin(target.accessPath, target.hostPath);
      yield* assertActive();
      return { ...target, assertActive };
    });
    const resolveTarget = Effect.fn(function* (
      address: FilesystemLocation,
      write = false,
    ) {
      yield* Effect.try({ try: requirePrincipal, catch: accessRejection });
      const root = yield* volumes.root(address.volume);
      return yield* resolveTargetNode(address, write, root);
    });
    function assertNotRoot(target: {
      hostPath: string;
      rootPath: string;
      accessPath: string;
    }): void {
      if (target.hostPath === target.rootPath)
        throw new FilesystemAccessDenied({
          message: "Cannot delete, move, or replace a volume root",
        });
      if (target.hostPath === target.accessPath)
        throw new FilesystemAccessDenied({
          message: "Cannot delete, move, or replace an access root",
        });
    }
    const openFile = Effect.fn(function* (
      location: FilesystemLocation,
      mode: FilesystemOpenMode,
      retained: boolean,
    ) {
      yield* Effect.try({ try: requirePrincipal, catch: accessRejection });
      const access = yield* volumes.lease([location.volume], !retained);
      return yield* access.effect(
        Effect.gen(function* () {
          const target = yield* resolveTarget(location);
          const file = yield* Effect.acquireRelease(
            io("open", () => fs.open(target.hostPath, openFlags[mode])),
            (descriptor) =>
              io("close", () => descriptor.close()).pipe(Effect.orDie),
          );
          if (!(yield* io("stat", () => file.stat())).isFile())
            return yield* Effect.fail(
              new FilesystemAccessDenied({
                message: "Filesystem source is not a regular file",
              }),
            );
          yield* target.assertActive();
          return {
            use: <A, E>(
              operation: (file: fs.FileHandle) => Effect.Effect<A, E>,
            ) =>
              access.effect(
                Effect.gen(function* () {
                  yield* target.assertActive();
                  const result = yield* operation(file);
                  yield* target.assertActive();
                  return result;
                }),
              ),
          } satisfies OpenedFilesystemFile;
        }),
      );
    });
    const handles = yield* createFileHandles(executionContext, openFile);
    const watcher = yield* createFilesystemWatches({
      resolveViewId: views.resolveViewId,
      viewRemoved: views.removed,
      notify: (viewId, payload) => changed.emit({ payload, viewIds: [viewId] }),
    });
    const forkListener = yield* FiberSet.makeRuntime<never, void, never>();
    yield* listen(views.removed, ({ webContentsId }) => {
      forkListener(
        handles
          .closeOwner({ webContentsId })
          .pipe(
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.failCause(cause)
                : Effect.sync(() =>
                    log.error(
                      "Failed to close view file handles:",
                      Cause.squash(cause),
                    ),
                  ),
            ),
          ),
      );
    });
    yield* listen(volumes.changed, ({ volumes: inventory }) =>
      watcher.removeUnavailableVolumes(
        new Set(
          inventory
            .filter((volume) => volume.state === "ready")
            .map((volume) => volume.id),
        ),
      ),
    );

    const resolvePath = (location: FilesystemLocation) =>
      volumes.withVolumes(
        [location.volume],
        Effect.map(resolveTarget(location), (target) => target.hostPath),
      );
    function prepareVolumeOperation<R, E>(
      ids: string[],
      run: (reporter: OperationReporter) => Effect.Effect<R, E>,
    ): OperationTask<R, E | VolumeUnavailable> {
      requirePrincipal();
      return volumes.prepareOperation(ids, run);
    }
    function withVolume<A, E, R>(
      location: FilesystemLocation,
      operation: (hostPath: string) => Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E | FilesystemPathError, R> {
      return volumes.withVolumes(
        [location.volume],
        Effect.flatMap(resolveTarget(location), (target) =>
          operation(target.hostPath),
        ),
      );
    }
    const toMaskedPath = Effect.fn(function* (
      absolutePath: string,
      volume: string,
    ) {
      return yield* volumes.withVolumes(
        [volume],
        Effect.gen(function* () {
          yield* Effect.try({ try: requirePrincipal, catch: accessRejection });
          const root = yield* volumes.root(volume);
          if (root) yield* root.assertActive();
          const rootPath = root?.rootPath ?? baseDir;
          const normalized = path.resolve(absolutePath);
          yield* Effect.try({
            try: () =>
              assertWithin(rootPath, normalized, `Path '${absolutePath}'`),
            catch: accessRejection,
          });
          const location = {
            volume,
            path: `/${path.relative(rootPath, normalized).split(path.sep).join("/")}`,
          };
          yield* resolveTarget(location);
          return location;
        }),
      );
    });
    const isPathAllowed = (location: FilesystemLocation) =>
      resolvePath(location).pipe(
        Effect.as(true),
        Effect.catch(() => Effect.succeed(false)),
      );
    function accessScope(volume: string): FilesystemLocation {
      requirePrincipal();
      volumes.get(volume);
      const accessPath = volume === "home" ? getHomeAccessPath() : undefined;
      const relative = accessPath ? path.relative(baseDir, accessPath) : "";
      return { volume, path: `/${relative.split(path.sep).join("/")}` };
    }
    const readFile = (
      source: FilesystemSource,
      encoding: BufferEncoding = "utf-8",
    ) =>
      handles.use(source, (file) =>
        readOpenedFile(file).pipe(
          Effect.map((buffer) => buffer.toString(encoding)),
        ),
      );
    const readBinaryFile = (source: FilesystemSource) =>
      handles.use(source, (file) =>
        readOpenedFile(file).pipe(
          Effect.map((buffer) => new Uint8Array(buffer)),
        ),
      );
    const writeContent = (
      location: FilesystemLocation,
      content: string | Uint8Array,
      encoding?: BufferEncoding,
    ) =>
      volumes.withVolumes(
        [location.volume],
        Effect.gen(function* () {
          const target = yield* resolveTarget(location, true);
          yield* target.assertActive();
          yield* io("mkdir", () =>
            fs.mkdir(path.dirname(target.hostPath), { recursive: true }),
          );
          yield* target.assertActive();
          yield* assertExistingWithin(target.rootPath, target.hostPath);
          if (target.accessPath !== target.rootPath)
            yield* assertExistingWithin(target.accessPath, target.hostPath);
          yield* target.assertActive();
          yield* io("writeFile", () =>
            fs.writeFile(target.hostPath, content, encoding),
          );
          watcher.invalidate(path.dirname(target.hostPath));
        }),
      );
    const writeFile = (
      location: FilesystemLocation,
      content: string,
      encoding: BufferEncoding = "utf-8",
    ) => writeContent(location, content, encoding);
    const writeBinaryFile = (
      location: FilesystemLocation,
      content: Uint8Array,
    ) => writeContent(location, content);
    const exists = (location: FilesystemLocation) =>
      volumes.withVolumes(
        [location.volume],
        Effect.gen(function* () {
          return yield* Effect.gen(function* () {
            const fullPath = yield* resolvePath(location);
            yield* io("access", () => fs.access(fullPath));
            return true;
          }).pipe(
            Effect.catch((error) => {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT")
                return Effect.fail(error);
              return Effect.gen(function* () {
                const root = yield* volumes.root(location.volume);
                if (root) yield* root.assertActive();
                return false;
              });
            }),
          );
        }),
      );
    const mkdir = (location: FilesystemLocation) =>
      volumes.withVolumes(
        [location.volume],
        Effect.gen(function* () {
          const target = yield* resolveTarget(location, true);
          yield* target.assertActive();
          yield* io("mkdir", () =>
            fs.mkdir(target.hostPath, { recursive: true }),
          );
          watcher.invalidate(path.dirname(target.hostPath));
        }),
      );
    const readdir = (location: FilesystemLocation) =>
      withVolume(location, (hostPath) =>
        io("readdir", () => fs.readdir(hostPath)),
      );
    const stat = Effect.fn(function* (
      source: FilesystemSource,
    ): Effect.fn.Return<FileStats, FilesystemFileError> {
      const stats = yield* "handleId" in source
        ? handles.use(source, (file) => io("stat", () => file.stat()))
        : withVolume(source, (hostPath) => io("stat", () => fs.stat(hostPath)));
      return {
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        size: stats.size,
        mtime: stats.mtime,
      };
    });
    const search = (
      location: FilesystemLocation,
      pattern: string,
      limit = 10,
    ) =>
      withVolume(location, (fullPath) =>
        Effect.gen(function* () {
          const entries = yield* io("search", () =>
            fg(pattern ? `**/*${pattern}*` : "**/*", {
              cwd: fullPath,
              onlyFiles: false,
              deep: 3,
              suppressErrors: true,
              stats: true,
              followSymbolicLinks: false,
            }),
          );
          const results: SearchResult[] = [];
          for (const entry of entries) {
            if (results.length >= limit) break;
            results.push({
              location: {
                volume: location.volume,
                path:
                  location.path === "/"
                    ? `/${entry.path}`
                    : `${location.path}/${entry.path}`,
              },
              name: path.basename(entry.path),
              type: entry.stats?.isDirectory() ? "folder" : "file",
            });
          }
          return results;
        }).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              log.error("Search error:", error);
              return [] as SearchResult[];
            }),
          ),
        ),
      );
    const remove = (
      location: FilesystemLocation,
      reporter?: OperationReporter,
    ) =>
      volumes.withVolumes(
        [location.volume],
        Effect.gen(function* () {
          reporter?.update("validating");
          const target = yield* resolveTarget(location, true);
          yield* Effect.try({
            try: () => assertNotRoot(target),
            catch: accessRejection,
          });
          const stats = yield* io("stat", () => fs.stat(target.hostPath));
          yield* target.assertActive();
          reporter?.update("deleting");
          yield* io("delete", () =>
            stats.isDirectory()
              ? fs.rm(target.hostPath, { recursive: true, force: true })
              : fs.unlink(target.hostPath),
          );
          watcher.invalidate(path.dirname(target.hostPath));
        }),
      );
    const copy = (
      from: FilesystemLocation,
      to: FilesystemLocation,
      overwrite = false,
      reporter?: OperationReporter,
    ) =>
      volumes.withVolumes(
        [from.volume, to.volume],
        Effect.gen(function* () {
          reporter?.update("validating");
          const source = yield* resolveTarget(from);
          const destination = yield* resolveTarget(to, true);
          yield* Effect.try({
            try: () => assertNotRoot(destination),
            catch: accessRejection,
          });
          yield* transfer.copy({
            source: source.hostPath,
            destination: destination.hostPath,
            destinationLabel: `${to.volume}:${to.path}`,
            assertSourceActive: source.assertActive,
            assertDestinationActive: destination.assertActive,
            overwrite,
            reporter,
          });
          watcher.invalidate(path.dirname(destination.hostPath));
        }),
      );
    const move = (
      from: FilesystemLocation,
      to: FilesystemLocation,
      overwrite = false,
      reporter?: OperationReporter,
    ) =>
      volumes.withVolumes(
        [from.volume, to.volume],
        Effect.gen(function* () {
          reporter?.update("validating");
          const source = yield* resolveTarget(from, true);
          const destination = yield* resolveTarget(to, true);
          yield* Effect.try({
            try: () => {
              assertNotRoot(source);
              assertNotRoot(destination);
            },
            catch: accessRejection,
          });
          yield* transfer.move({
            source: source.hostPath,
            destination: destination.hostPath,
            destinationLabel: `${to.volume}:${to.path}`,
            assertSourceActive: source.assertActive,
            assertDestinationActive: destination.assertActive,
            overwrite,
            reporter,
          });
          watcher.invalidate(path.dirname(source.hostPath));
          watcher.invalidate(path.dirname(destination.hostPath));
        }),
      );
    const watchDirectory = (
      location: FilesystemLocation,
      webContentsId: number | undefined,
    ) =>
      volumes.withVolumes(
        [location.volume],
        Effect.gen(function* () {
          const target = yield* resolveTarget(location);
          yield* Effect.try({
            try: () => {
              if (!volumes.get(location.volume).supportsWatch)
                throw new FilesystemWatchRejected({
                  message: "Filesystem volume does not support watching",
                });
            },
            catch: watchRejection,
          });
          const stats = yield* io("stat", () => fs.stat(target.hostPath));
          yield* target.assertActive();
          return yield* Effect.try({
            try: () => {
              if (!stats.isDirectory())
                throw new FilesystemWatchRejected({
                  message: `Path '${location.path}' is not a directory`,
                });
              if (volumes.get(location.volume).state !== "ready")
                throw new FilesystemWatchRejected({
                  message: "Filesystem volume is being removed",
                });
              return watcher.watch(
                target.hostPath,
                webContentsId,
                location.volume,
              );
            },
            catch: watchRejection,
          });
        }),
      );
    return {
      getBaseDir: () => baseDir,
      changed,
      accessScope,
      resolvePath,
      prepareVolumeOperation,
      withVolume,
      toMaskedPath,
      isPathAllowed,
      readFile,
      readBinaryFile,
      writeFile,
      writeBinaryFile,
      exists,
      mkdir,
      readdir,
      stat,
      search,
      delete: remove,
      copy,
      move,
      watchDirectory,
      unwatch: watcher.unwatch,
      open: handles.open,
      close: handles.close,
      closeOwner: handles.closeOwner,
      releaseHandles: (sessionId?: string) => handles.closeOwner({ sessionId }),
      closeHandles: handles.dispose,
    };
  }),
);
