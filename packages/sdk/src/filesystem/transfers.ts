import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import { fromPromise } from "../effects/io";
import type { OperationReporter } from "../operations/task";

interface TransferRequest {
  source: string;
  destination: string;
  destinationLabel: string;
  overwrite: boolean;
  reporter?: OperationReporter;
  assertSourceActive?: () => Promise<void>;
  assertDestinationActive?: () => Promise<void>;
}

interface PreparedTransfer {
  source: string;
  destination: string;
  destinationExists: boolean;
  reporter?: OperationReporter;
  assertSourceActive?: () => Promise<void>;
  assertDestinationActive?: () => Promise<void>;
}

interface PathReservation {
  paths: string[];
  completed: Deferred.Deferred<void>;
}

export function createFileTransfers() {
  const reservations = new Set<PathReservation>();
  const io = <A>(run: () => Promise<A>) =>
    fromPromise(run).pipe(Effect.uninterruptible);

  const copy = (request: TransferRequest) =>
    withReservedPaths(request, copyReserved(request));
  const move = (request: TransferRequest) =>
    withReservedPaths(request, moveReserved(request));

  function withReservedPaths(
    request: TransferRequest,
    work: Effect.Effect<void, Error>,
  ) {
    return Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const paths = [
          path.resolve(request.source),
          path.resolve(request.destination),
          yield* io(() => resolveCanonicalPath(request.source)),
          yield* io(() => resolveCanonicalPath(request.destination)),
        ];
        const predecessors = [...reservations].filter((reservation) =>
          reservation.paths.some((reserved) =>
            paths.some(
              (candidate) =>
                reserved === candidate ||
                isPathWithin(reserved, candidate) ||
                isPathWithin(candidate, reserved),
            ),
          ),
        );
        const reservation = { paths, completed: yield* Deferred.make<void>() };
        return yield* Effect.acquireUseRelease(
          Effect.sync(() => {
            reservations.add(reservation);
            return reservation;
          }),
          () =>
            restore(
              Effect.andThen(
                Effect.forEach(
                  predecessors,
                  (entry) => Deferred.await(entry.completed),
                  { discard: true },
                ),
                work,
              ),
            ),
          () =>
            Effect.andThen(
              Effect.sync(() => reservations.delete(reservation)),
              Deferred.succeed(reservation.completed, undefined),
            ),
        );
      }),
    );
  }

  const copyReserved = Effect.fn(function* (request: TransferRequest) {
    yield* io(() => assertActive(request));
    request.reporter?.update("preparing-copy");
    const transfer = yield* prepare(request, "copy");
    yield* runWithDestinationRollback(
      transfer,
      fromPromise((signal) => copyEntry(transfer, signal)),
    );
  });

  const moveReserved = Effect.fn(function* (request: TransferRequest) {
    request.reporter?.update("preparing-move");
    const transfer = yield* prepare(request, "move");
    let copied = false;
    yield* runWithDestinationRollback(
      transfer,
      Effect.gen(function* () {
        yield* io(() => assertActive(transfer));
        transfer.reporter?.update("moving");
        yield* io(() => fs.rename(transfer.source, transfer.destination)).pipe(
          Effect.catch((error) => {
            if ((error as NodeJS.ErrnoException).code !== "EXDEV")
              return Effect.fail(error);
            return fromPromise((signal) => copyEntry(transfer, signal)).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  copied = true;
                }),
              ),
            );
          }),
        );
      }),
    );
    if (copied) {
      yield* Effect.gen(function* () {
        yield* io(() => assertActive(transfer));
        transfer.reporter?.update("removing-source");
        yield* io(() =>
          fs.rm(transfer.source, { recursive: true, force: false }),
        );
      }).pipe(
        Effect.mapError(
          (error) =>
            new Error(
              "Move copied the destination but could not completely remove the source",
              { cause: error },
            ),
        ),
      );
    }
  });

  const prepare = Effect.fn(function* (
    request: TransferRequest,
    operation: "copy" | "move",
  ) {
    const sourceStats = yield* io(() => fs.stat(request.source));
    const canonicalSource = yield* io(() => fs.realpath(request.source));
    const canonicalDestination = yield* io(() =>
      resolveCanonicalPath(request.destination),
    );
    if (canonicalSource === canonicalDestination)
      return yield* Effect.fail(
        new Error("Source and destination must be different"),
      );
    if (
      sourceStats.isDirectory() &&
      isPathWithin(canonicalSource, canonicalDestination)
    )
      return yield* Effect.fail(
        new Error(
          `Cannot ${operation} a directory into itself or a descendant`,
        ),
      );
    if (isPathWithin(canonicalDestination, canonicalSource))
      return yield* Effect.fail(
        new Error("Source and destination paths overlap"),
      );
    const destinationExists = yield* io(() => pathExists(request.destination));
    if (destinationExists && !request.overwrite)
      return yield* Effect.fail(
        new Error(`Destination '${request.destinationLabel}' already exists`),
      );
    yield* io(() => assertActive(request));
    yield* io(() =>
      fs.mkdir(path.dirname(request.destination), { recursive: true }),
    );
    return {
      reporter: request.reporter,
      source: request.source,
      destination: request.destination,
      destinationExists,
      assertSourceActive: request.assertSourceActive,
      assertDestinationActive: request.assertDestinationActive,
    };
  });

  const runWithDestinationRollback = (
    transfer: PreparedTransfer,
    work: Effect.Effect<void, Error>,
  ) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        yield* io(() => assertActive(transfer));
        const backup = transfer.destinationExists
          ? yield* io(() => stageDestination(transfer.destination))
          : undefined;
        yield* restore(
          Effect.andThen(
            work,
            io(() => assertActive(transfer)),
          ),
        ).pipe(
          Effect.catchCause((cause) =>
            io(async () => {
              transfer.reporter?.update("rolling-back");
              const rollbackErrors: unknown[] = [];
              try {
                await transfer.assertDestinationActive?.();
                await fs.rm(transfer.destination, {
                  recursive: true,
                  force: true,
                });
              } catch (cleanupError) {
                rollbackErrors.push(cleanupError);
              }
              if (backup) {
                try {
                  await transfer.assertDestinationActive?.();
                  await fs.rename(backup, transfer.destination);
                } catch (restoreError) {
                  rollbackErrors.push(restoreError);
                }
              }
              if (rollbackErrors.length)
                throw new AggregateError(
                  [Cause.squash(cause), ...rollbackErrors],
                  "Filesystem transfer failed and rollback was incomplete",
                );
            }).pipe(Effect.andThen(Effect.failCause(cause))),
          ),
        );
        if (backup) {
          transfer.reporter?.update("cleaning-up");
          yield* io(async () => {
            await transfer.assertDestinationActive?.();
            await fs.rm(backup, { recursive: true, force: true });
          });
        }
      }),
    );

  async function stageDestination(destination: string): Promise<string> {
    const backup = path.join(
      path.dirname(destination),
      `.${path.basename(destination)}.eden-transfer-${randomUUID()}`,
    );
    await fs.rename(destination, backup);
    return backup;
  }

  async function assertActive(
    transfer: TransferRequest | PreparedTransfer,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    await transfer.assertSourceActive?.();
    await transfer.assertDestinationActive?.();
    signal?.throwIfAborted();
  }

  async function copyEntry(
    transfer: PreparedTransfer,
    signal: AbortSignal,
  ): Promise<void> {
    const { source, destination } = transfer;
    const sourceStats = await fs.lstat(source);
    const total = sourceStats.isFile() ? sourceStats.size : undefined;
    let completed = 0;
    let lastReport = 0;
    const report = () => {
      transfer.reporter?.update("copying", { completed, total, unit: "bytes" });
      lastReport = Date.now();
    };
    report();
    lastReport = 0;
    await fs.cp(source, destination, {
      recursive: true,
      verbatimSymlinks: true,
      filter: async (entrySource, entryDestination) => {
        await assertActive(transfer, signal);
        if (transfer.reporter) {
          const stats = await fs.lstat(entrySource);
          if (stats.isFile()) {
            // Keep native directory and symlink semantics, but stream regular
            // files so even a single large file can report transferred bytes.
            await pipeline(
              createReadStream(entrySource, { highWaterMark: 1024 * 1024 }),
              async function* (chunks) {
                for await (const chunk of chunks) {
                  yield chunk;
                  completed += chunk.length;
                  if (Date.now() - lastReport >= 100) report();
                }
              },
              createWriteStream(entryDestination, {
                flags: "wx",
                mode: stats.mode,
              }),
              { signal },
            );
            await fs.chmod(entryDestination, stats.mode);
            await assertActive(transfer, signal);
            if (Date.now() - lastReport >= 100) report();
            return false;
          }
        }
        return true;
      },
      errorOnExist: true,
      force: false,
    });
    await assertActive(transfer, signal);
    report();
  }

  async function pathExists(hostPath: string): Promise<boolean> {
    try {
      await fs.lstat(hostPath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  async function resolveCanonicalPath(hostPath: string): Promise<string> {
    let existingPath = hostPath;
    const missingSegments: string[] = [];

    while (true) {
      try {
        return path.resolve(
          await fs.realpath(existingPath),
          ...missingSegments,
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const parent = path.dirname(existingPath);
        if (parent === existingPath) throw error;
        missingSegments.unshift(path.basename(existingPath));
        existingPath = parent;
      }
    }
  }

  function isPathWithin(parentPath: string, candidatePath: string): boolean {
    const relative = path.relative(parentPath, candidatePath);
    return (
      relative !== "" &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    );
  }
  return { copy, move };
}
