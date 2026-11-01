import { randomUUID } from "node:crypto";
import * as path from "node:path";
import type {
  FilesystemLocation,
  TrashEntry,
  TrashRestoreResult,
} from "@edenapp/types";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as v from "valibot";
import type { OperationReporter } from "../../core/operations/task";
import { log } from "../logging/logger";
import {
  accessRejection,
  FilesystemAccessDenied,
  type FilesystemPathError,
  type FilesystemTransferError,
} from "./errors";
import { isPathWithin } from "./lexical-path";
import { type FilesystemIoFailed, nativeFailure } from "./native-errors";
import { io } from "./native-io";
import type { createFileTransfers } from "./transfers";

/** Home-root folder reserved for Trash storage; the public filesystem API cannot reach it. */
export const TRASH_DIRECTORY = ".eden-trash";
const ENTRY_FILE = "entry.json";
const CONTENT = "content";

const storedEntry = v.object({
  path: v.pipe(v.string(), v.startsWith("/")),
  deletedAt: v.pipe(v.string(), v.isoTimestamp()),
});

interface ResolvedTarget {
  hostPath: string;
  assertActive: () => Effect.Effect<void, Error>;
}

interface TrashOptions {
  baseDir: string;
  /** Host path of the caller's Home access scope. Throws FilesystemAccessDenied. */
  homeAccessPath: () => string;
  /** Resolve a writable entry without following its leaf, refusing volume and access roots. */
  resolveEntry: (
    location: FilesystemLocation,
  ) => Effect.Effect<ResolvedTarget, FilesystemPathError>;
  transfer: ReturnType<typeof createFileTransfers>;
  invalidate: (directory: string) => void;
  changed: () => void;
}

export function createTrash(options: TrashOptions) {
  const root = path.join(options.baseDir, TRASH_DIRECTORY);
  // Entries being written; their missing content is not an abandoned move.
  const pending = new Set<string>();

  const directoryOf = (id: string) => path.join(root, id);
  const contentOf = (id: string) => path.join(root, id, CONTENT);
  const homeLocation = (hostPath: string): FilesystemLocation => ({
    volume: "home",
    path: `/${path.relative(options.baseDir, hostPath).split(path.sep).join("/")}`,
  });
  const accessPath = () =>
    Effect.try({ try: options.homeAccessPath, catch: accessRejection });
  const isMissing = (error: FilesystemIoFailed) => error.code === "ENOENT";
  const unavailable = () =>
    new FilesystemAccessDenied({ message: "Trash item is unavailable" });

  const readEntry = Effect.fn(function* (id: string) {
    const stats = yield* io.lstat(contentOf(id));
    const text = yield* io.readFile(
      path.join(directoryOf(id), ENTRY_FILE),
      "utf8",
    );
    const stored = yield* Effect.try({
      try: () => v.parse(storedEntry, JSON.parse(text)),
      catch: (cause) =>
        nativeFailure("readFile", cause, {
          path: path.join(directoryOf(id), ENTRY_FILE),
          message: `Trash entry '${id}' has invalid metadata`,
        }),
    });
    return {
      id,
      name: path.posix.basename(stored.path),
      original: { volume: "home", path: stored.path },
      deletedAt: stored.deletedAt,
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
      size: stats.size,
    } satisfies TrashEntry;
  });

  const isVisible = (entry: TrashEntry, scope: string) =>
    isPathWithin(scope, path.join(options.baseDir, entry.original.path));

  const visibleEntry = Effect.fn(function* (id: string) {
    const scope = yield* accessPath();
    const entry = yield* readEntry(id).pipe(
      Effect.mapError((error) => (isMissing(error) ? unavailable() : error)),
    );
    if (!isVisible(entry, scope)) return yield* Effect.fail(unavailable());
    return entry;
  });

  const discardIfEmpty = (id: string) =>
    io.lstat(contentOf(id)).pipe(
      Effect.asVoid,
      Effect.catch((error) =>
        isMissing(error)
          ? io.rm(directoryOf(id), { recursive: true, force: true })
          : Effect.void,
      ),
      Effect.ignore,
    );

  const list = Effect.gen(function* () {
    const scope = yield* accessPath();
    const ids = yield* io
      .readdir(root)
      .pipe(
        Effect.catch((error) =>
          isMissing(error) ? Effect.succeed([]) : Effect.fail(error),
        ),
      );
    const entries = yield* Effect.forEach(
      ids,
      (id) =>
        readEntry(id).pipe(
          Effect.catch((error) => {
            if (isMissing(error) && !pending.has(id))
              return Effect.as(discardIfEmpty(id), undefined);
            return Effect.sync(() => {
              log.warn(`Skipping unreadable Trash entry '${id}':`, error);
              return undefined;
            });
          }),
        ),
      { concurrency: 16 },
    );
    return entries
      .filter(
        (entry): entry is TrashEntry => !!entry && isVisible(entry, scope),
      )
      .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  });

  const move = Effect.fn(function* (
    location: FilesystemLocation,
    reporter?: OperationReporter,
  ) {
    reporter?.update("validating");
    if (location.volume !== "home")
      return yield* Effect.fail(
        new FilesystemAccessDenied({
          path: location.path,
          message: "Trash only holds items from Home",
        }),
      );
    const source = yield* options.resolveEntry(location);
    const id = randomUUID();
    const deletedAt = new Date(yield* Clock.currentTimeMillis).toISOString();
    pending.add(id);
    yield* Effect.gen(function* () {
      yield* io.mkdir(directoryOf(id));
      yield* io.writeFileAtomic(
        path.join(directoryOf(id), ENTRY_FILE),
        JSON.stringify({ path: homeLocation(source.hostPath).path, deletedAt }),
      );
      yield* options.transfer.move({
        source: source.hostPath,
        destination: contentOf(id),
        destinationLabel: "Trash",
        overwrite: false,
        reporter,
        assertSourceActive: source.assertActive,
      });
    }).pipe(
      // An incomplete cross-filesystem move keeps its copy as a restorable entry.
      Effect.onError(() => discardIfEmpty(id)),
      Effect.ensuring(Effect.sync(() => pending.delete(id))),
    );
    options.invalidate(path.dirname(source.hostPath));
    options.changed();
  });

  const restore = Effect.fn(function* (
    id: string,
    destination?: FilesystemLocation,
    reporter?: OperationReporter,
  ): Effect.fn.Return<
    TrashRestoreResult,
    FilesystemPathError | FilesystemTransferError
  > {
    reporter?.update("validating");
    const entry = yield* visibleEntry(id);
    const location = destination ?? entry.original;
    const target = yield* options.resolveEntry(location);
    const occupied = io.lstat(target.hostPath).pipe(
      Effect.as(true),
      Effect.catch((error) =>
        isMissing(error) ? Effect.succeed(false) : Effect.fail(error),
      ),
    );
    if (yield* occupied) return { status: "occupied" };
    const moved = yield* options.transfer
      .move({
        source: contentOf(id),
        destination: target.hostPath,
        destinationLabel: `${location.volume}:${location.path}`,
        overwrite: false,
        reporter,
        assertDestinationActive: target.assertActive,
      })
      .pipe(
        Effect.as(true),
        Effect.catchTag("FilesystemTransferRejected", (error) =>
          Effect.flatMap(occupied, (exists) =>
            exists ? Effect.succeed(false) : Effect.fail(error),
          ),
        ),
      );
    if (!moved) return { status: "occupied" };
    yield* io.rm(directoryOf(id), { recursive: true, force: true });
    options.invalidate(path.dirname(target.hostPath));
    options.changed();
    return { status: "restored", location };
  });

  const remove = Effect.fn(function* (
    id: string,
    reporter?: OperationReporter,
  ) {
    reporter?.update("validating");
    yield* visibleEntry(id);
    reporter?.update("deleting");
    yield* io.rm(directoryOf(id), { recursive: true, force: true });
    options.changed();
  });

  const empty = Effect.fn(function* (reporter?: OperationReporter) {
    reporter?.update("validating");
    const entries = yield* list;
    if (!entries.length) return;
    yield* Effect.gen(function* () {
      for (const [index, entry] of entries.entries()) {
        reporter?.update("deleting", {
          completed: index,
          total: entries.length,
          unit: "items",
        });
        yield* io.rm(directoryOf(entry.id), { recursive: true, force: true });
      }
    }).pipe(Effect.ensuring(Effect.sync(options.changed)));
  });

  return { list, move, restore, delete: remove, empty };
}
