import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  FileStats,
  FilesystemChangeKind,
  FilesystemLocation,
  FilesystemOpenMode,
  FilesystemSource,
  SearchResult,
} from "@edenapp/types";
import * as Effect from "effect/Effect";
import fg from "fast-glob";
import type { TargetedNotification } from "../controllers/events";
import { asError, fromPromise } from "../effects/io";
import type { Event } from "../events/event";
import { listen, scopedEvent } from "../events/scoped";
import type { ExecutionContext } from "../execution/context";
import { log } from "../logging";
import type { OperationReporter, OperationTask } from "../operations/task";
import {
  assertExistingPathWithin,
  assertPathWithin,
  normalizeDirectoryRestriction,
  resolveDirectoryRestriction,
} from "../user/directory-restriction";
import {
  createFileHandles,
  type OpenedFilesystemFile,
  readOpenedFile,
} from "./file-handles";
import { createFileTransfers } from "./transfers";
import type { VolumeRoot, Volumes } from "./volumes";
import { createFilesystemWatches } from "./watches";

export interface FilesystemViews {
  resolveViewId(webContentsId: number): number | undefined;
  removed: Pick<Event<{ viewId: number; webContentsId: number }>, "on">;
}
interface FilesystemDependencies {
  baseDir: string;
  executionContext: ExecutionContext;
  views: FilesystemViews;
  volumes: Volumes;
}
const openFlags: Record<FilesystemOpenMode, number> = {
  read: constants.O_RDONLY | constants.O_NONBLOCK,
};
const io = <A>(run: () => Promise<A>) =>
  fromPromise(run).pipe(Effect.uninterruptible);

/** Filesystem state and resource ownership, independent of command transport. */
export const createFilesystem = Effect.fn(function* ({
  baseDir: inputBaseDir,
  executionContext,
  views,
  volumes,
}: FilesystemDependencies) {
  const baseDir = path.resolve(inputBaseDir);
  const changed =
    yield* scopedEvent<
      TargetedNotification<{ watchId: string; kind: FilesystemChangeKind }>
    >();
  const transfer = createFileTransfers();

  function requirePrincipal(): void {
    const principal = executionContext.getPrincipal();
    if (principal?.kind !== "user" && principal?.kind !== "system")
      throw new Error("Caller has no filesystem execution principal");
  }
  function getHomeAccessPath(): string {
    const principal = executionContext.getPrincipal();
    if (principal?.kind === "system") return baseDir;
    if (principal?.kind !== "user")
      throw new Error("Caller has no filesystem execution principal");
    const user = principal.profile;
    if (user.role === "vendor") return baseDir;
    const restriction = normalizeDirectoryRestriction(
      user.directoryRestriction,
    );
    return restriction
      ? resolveDirectoryRestriction(baseDir, restriction)
      : baseDir;
  }
  // Node descriptor callbacks retain their admission across native I/O.
  async function resolveTargetNode(
    address: FilesystemLocation,
    write: boolean,
    mounted: VolumeRoot | undefined,
  ) {
    requirePrincipal();
    const info = volumes.get(address.volume);
    if (write && info.readOnly)
      throw new Error(`Filesystem volume '${address.volume}' is read-only`);
    const rootPath = mounted?.rootPath ?? baseDir;
    const accessPath = mounted?.rootPath ?? getHomeAccessPath();
    const assertActive = async () => {
      await mounted?.assertActive();
    };
    await assertActive();
    const hostPath = path.resolve(
      rootPath,
      address.path.replace(/^[\\/]+/, ""),
    );
    assertPathWithin(rootPath, hostPath, `Path '${address.path}'`);
    assertPathWithin(accessPath, hostPath, `Path '${address.path}'`);
    await assertExistingPathWithin(rootPath, hostPath);
    if (accessPath !== rootPath)
      await assertExistingPathWithin(accessPath, hostPath);
    await assertActive();
    return { hostPath, rootPath, accessPath, assertActive };
  }
  const resolveTarget = Effect.fn(function* (
    address: FilesystemLocation,
    write = false,
  ) {
    yield* Effect.try({ try: requirePrincipal, catch: asError });
    const root = yield* volumes.root(address.volume);
    return yield* io(() => resolveTargetNode(address, write, root));
  });
  function assertNotRoot(target: {
    hostPath: string;
    rootPath: string;
    accessPath: string;
  }): void {
    if (target.hostPath === target.rootPath)
      throw new Error("Cannot delete, move, or replace a volume root");
    if (target.hostPath === target.accessPath)
      throw new Error("Cannot delete, move, or replace an access root");
  }
  const openFile = Effect.fn(function* (
    location: FilesystemLocation,
    mode: FilesystemOpenMode,
    retained: boolean,
  ) {
    yield* Effect.try({ try: requirePrincipal, catch: asError });
    const access = yield* volumes.lease([location.volume], !retained);
    return yield* access.effect(
      Effect.gen(function* () {
        const target = yield* resolveTarget(location);
        const file = yield* Effect.acquireRelease(
          io(() => fs.open(target.hostPath, openFlags[mode])),
          (descriptor) => io(() => descriptor.close()).pipe(Effect.orDie),
        );
        if (!(yield* io(() => file.stat())).isFile())
          return yield* Effect.fail(
            new Error("Filesystem source is not a regular file"),
          );
        yield* io(target.assertActive);
        return {
          use: <A, E>(
            operation: (file: fs.FileHandle) => Effect.Effect<A, E>,
          ) =>
            access.effect(
              Effect.gen(function* () {
                yield* io(target.assertActive);
                const result = yield* operation(file);
                yield* io(target.assertActive);
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
  const runListener = Effect.runPromiseWith(yield* Effect.context<never>());
  yield* listen(views.removed, ({ webContentsId }) =>
    runListener(handles.closeOwner({ webContentsId })),
  );
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
  function prepareVolumeOperation<R>(
    ids: string[],
    run: (reporter: OperationReporter) => Effect.Effect<R, unknown>,
  ): OperationTask<R> {
    requirePrincipal();
    return volumes.prepareOperation(ids, run);
  }
  function withVolume<A, E>(
    location: FilesystemLocation,
    operation: (hostPath: string) => Effect.Effect<A, E>,
  ): Effect.Effect<A, E | Error> {
    return volumes.withVolumes(
      [location.volume],
      Effect.flatMap(resolvePath(location), operation),
    );
  }
  const toMaskedPath = Effect.fn(function* (
    absolutePath: string,
    volume: string,
  ) {
    return yield* volumes.withVolumes(
      [volume],
      Effect.gen(function* () {
        yield* Effect.try({ try: requirePrincipal, catch: asError });
        const root = yield* volumes.root(volume);
        if (root) yield* io(root.assertActive);
        const rootPath = root?.rootPath ?? baseDir;
        const normalized = path.resolve(absolutePath);
        yield* Effect.try({
          try: () =>
            assertPathWithin(rootPath, normalized, `Path '${absolutePath}'`),
          catch: asError,
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
      io(async () => (await readOpenedFile(file)).toString(encoding)),
    );
  const readBinaryFile = (source: FilesystemSource) =>
    handles.use(source, (file) =>
      io(async () => new Uint8Array(await readOpenedFile(file))),
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
        yield* io(target.assertActive);
        yield* io(() =>
          fs.mkdir(path.dirname(target.hostPath), { recursive: true }),
        );
        yield* io(target.assertActive);
        yield* io(() =>
          assertExistingPathWithin(target.rootPath, target.hostPath),
        );
        if (target.accessPath !== target.rootPath)
          yield* io(() =>
            assertExistingPathWithin(target.accessPath, target.hostPath),
          );
        yield* io(target.assertActive);
        yield* io(() => fs.writeFile(target.hostPath, content, encoding));
        watcher.invalidate(path.dirname(target.hostPath));
      }),
    );
  const writeFile = (
    location: FilesystemLocation,
    content: string,
    encoding: BufferEncoding = "utf-8",
  ) => writeContent(location, content, encoding);
  const writeBinaryFile = (location: FilesystemLocation, content: Uint8Array) =>
    writeContent(location, content);
  const exists = (location: FilesystemLocation) =>
    volumes.withVolumes(
      [location.volume],
      Effect.gen(function* () {
        return yield* Effect.gen(function* () {
          const fullPath = yield* resolvePath(location);
          yield* io(() => fs.access(fullPath));
          return true;
        }).pipe(
          Effect.catch((error) => {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT")
              return Effect.fail(error);
            return Effect.gen(function* () {
              const root = yield* volumes.root(location.volume);
              if (root) yield* io(root.assertActive);
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
        yield* io(target.assertActive);
        yield* io(() => fs.mkdir(target.hostPath, { recursive: true }));
        watcher.invalidate(path.dirname(target.hostPath));
      }),
    );
  const readdir = (location: FilesystemLocation) =>
    withVolume(location, (hostPath) => io(() => fs.readdir(hostPath)));
  const stat = Effect.fn(function* (
    source: FilesystemSource,
  ): Effect.fn.Return<FileStats, Error> {
    const stats = yield* "handleId" in source
      ? handles.use(source, (file) => io(() => file.stat()))
      : withVolume(source, (hostPath) => io(() => fs.stat(hostPath)));
    return {
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      size: stats.size,
      mtime: stats.mtime,
    };
  });
  const search = (location: FilesystemLocation, pattern: string, limit = 10) =>
    withVolume(location, (fullPath) =>
      io(async () => {
        try {
          const entries = await fg(pattern ? `**/*${pattern}*` : "**/*", {
            cwd: fullPath,
            onlyFiles: false,
            deep: 3,
            suppressErrors: true,
            stats: true,
            followSymbolicLinks: false,
          });
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
        } catch (error) {
          log.error("Search error:", error);
          return [];
        }
      }),
    );
  const remove = (location: FilesystemLocation, reporter?: OperationReporter) =>
    volumes.withVolumes(
      [location.volume],
      Effect.gen(function* () {
        reporter?.update("validating");
        const target = yield* resolveTarget(location, true);
        yield* Effect.try({ try: () => assertNotRoot(target), catch: asError });
        const stats = yield* io(() => fs.stat(target.hostPath));
        yield* io(target.assertActive);
        reporter?.update("deleting");
        yield* io(() =>
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
          catch: asError,
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
          catch: asError,
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
              throw new Error("Filesystem volume does not support watching");
          },
          catch: asError,
        });
        const stats = yield* io(() => fs.stat(target.hostPath));
        yield* io(target.assertActive);
        return yield* Effect.try({
          try: () => {
            if (!stats.isDirectory())
              throw new Error(`Path '${location.path}' is not a directory`);
            if (volumes.get(location.volume).state !== "ready")
              throw new Error("Filesystem volume is being removed");
            return watcher.watch(
              target.hostPath,
              webContentsId,
              location.volume,
            );
          },
          catch: asError,
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
});
export type Filesystem = Effect.Success<ReturnType<typeof createFilesystem>>;
