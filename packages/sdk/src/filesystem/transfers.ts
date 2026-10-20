import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Result from "effect/Result";
import { fromPromise } from "../effects/io";
import type { OperationReporter } from "../operations/task";
import {
  FilesystemAccessDenied,
  FilesystemIoFailed,
  type FilesystemPathError,
  type FilesystemTransferError,
  FilesystemTransferIncomplete,
  FilesystemTransferRejected,
  VolumeIoFailed,
  VolumeUnavailable,
} from "./errors";

interface TransferRequest {
  source: string;
  destination: string;
  destinationLabel: string;
  overwrite: boolean;
  reporter?: OperationReporter;
  assertSourceActive?: () => Effect.Effect<void, Error>;
  assertDestinationActive?: () => Effect.Effect<void, Error>;
}

interface PreparedTransfer {
  source: string;
  destination: string;
  destinationExists: boolean;
  reporter?: OperationReporter;
  assertSourceActive?: () => Effect.Effect<void, Error>;
  assertDestinationActive?: () => Effect.Effect<void, Error>;
}

interface PathReservation {
  paths: string[];
  completed: Deferred.Deferred<void>;
}

export function createFileTransfers() {
  const reservations = new Set<PathReservation>();
  const nativeError = (operation: string, cause: unknown) =>
    new FilesystemIoFailed({
      operation,
      path: (cause as NodeJS.ErrnoException)?.path,
      cause,
      message: `Filesystem ${operation} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    });
  const io = <A>(operation: string, run: () => Promise<A>) =>
    fromPromise(run, (cause) => nativeError(operation, cause)).pipe(
      Effect.uninterruptible,
    );

  const copy = (request: TransferRequest) =>
    withReservedPaths(request, copyReserved(request));
  const move = (request: TransferRequest) =>
    withReservedPaths(request, moveReserved(request));

  function withReservedPaths(
    request: TransferRequest,
    work: Effect.Effect<void, FilesystemTransferError>,
  ) {
    return Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const paths = [
          path.resolve(request.source),
          path.resolve(request.destination),
          yield* resolveCanonicalPath(request.source),
          yield* resolveCanonicalPath(request.destination),
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
    yield* assertActive(request);
    request.reporter?.update("preparing-copy");
    const transfer = yield* prepare(request, "copy");
    yield* runWithDestinationRollback(transfer, copyEntry(transfer));
  });

  const moveReserved = Effect.fn(function* (request: TransferRequest) {
    request.reporter?.update("preparing-move");
    const transfer = yield* prepare(request, "move");
    let copied = false;
    // Finish a committed rename and its backup cleanup before interruption.
    yield* runWithDestinationRollback(
      transfer,
      Effect.gen(function* () {
        yield* assertActive(transfer);
        transfer.reporter?.update("moving");
        yield* io("rename", () =>
          fs.rename(transfer.source, transfer.destination),
        ).pipe(
          Effect.catch((error) => {
            if ((error as NodeJS.ErrnoException).code !== "EXDEV")
              return Effect.fail(error);
            return copyEntry(transfer).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  copied = true;
                }),
              ),
            );
          }),
        );
      }),
    ).pipe(Effect.uninterruptible);
    if (copied) {
      yield* Effect.gen(function* () {
        yield* assertActive(transfer);
        transfer.reporter?.update("removing-source");
        yield* io("rm", () =>
          fs.rm(transfer.source, { recursive: true, force: false }),
        );
      }).pipe(
        Effect.mapError(
          (error) =>
            new FilesystemTransferIncomplete({
              source: transfer.source,
              destination: transfer.destination,
              message:
                "Move copied the destination but could not completely remove the source",
              cause: error,
            }),
        ),
      );
    }
  });

  const prepare = Effect.fn(function* (
    request: TransferRequest,
    operation: "copy" | "move",
  ) {
    const sourceStats = yield* io("stat", () => fs.stat(request.source));
    const canonicalSource = yield* io("realpath", () =>
      fs.realpath(request.source),
    );
    const canonicalDestination = yield* resolveCanonicalPath(
      request.destination,
    );
    if (canonicalSource === canonicalDestination)
      return yield* Effect.fail(
        new FilesystemTransferRejected({
          source: request.source,
          destination: request.destination,
          message: "Source and destination must be different",
        }),
      );
    if (
      sourceStats.isDirectory() &&
      isPathWithin(canonicalSource, canonicalDestination)
    )
      return yield* Effect.fail(
        new FilesystemTransferRejected({
          source: request.source,
          destination: request.destination,
          message: `Cannot ${operation} a directory into itself or a descendant`,
        }),
      );
    if (isPathWithin(canonicalDestination, canonicalSource))
      return yield* Effect.fail(
        new FilesystemTransferRejected({
          source: request.source,
          destination: request.destination,
          message: "Source and destination paths overlap",
        }),
      );
    const destinationExists = yield* pathExists(request.destination);
    if (destinationExists && !request.overwrite)
      return yield* Effect.fail(
        new FilesystemTransferRejected({
          source: request.source,
          destination: request.destination,
          message: `Destination '${request.destinationLabel}' already exists`,
        }),
      );
    yield* assertActive(request);
    yield* io("mkdir", () =>
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
    work: Effect.Effect<void, FilesystemTransferError>,
  ) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        yield* assertActive(transfer);
        const backup = transfer.destinationExists
          ? yield* stageDestination(transfer.destination)
          : undefined;
        yield* restore(work).pipe(
          Effect.catchCause((cause) =>
            Effect.gen(function* () {
              transfer.reporter?.update("rolling-back");
              const rollback = [
                Effect.gen(function* () {
                  yield* assertAccessible(
                    transfer.assertDestinationActive,
                    transfer.destination,
                  );
                  yield* io("rm", () =>
                    fs.rm(transfer.destination, {
                      recursive: true,
                      force: true,
                    }),
                  );
                }),
              ];
              if (backup)
                rollback.push(
                  Effect.gen(function* () {
                    yield* assertAccessible(
                      transfer.assertDestinationActive,
                      transfer.destination,
                    );
                    yield* io("rename", () =>
                      fs.rename(backup, transfer.destination),
                    );
                  }),
                );
              const rollbackExits = yield* Effect.forEach(rollback, (step) =>
                Effect.exit(step),
              );
              const rollbackFailures = rollbackExits.filter(Exit.isFailure);
              if (rollbackFailures.length) {
                const rollbackCause = rollbackFailures
                  .map((exit) => exit.cause)
                  .reduce(Cause.combine);
                const incomplete = new FilesystemTransferIncomplete({
                  source: transfer.source,
                  destination: transfer.destination,
                  message: `Filesystem transfer failed and rollback was incomplete${backup ? `. Recovery files retained at ${backup}` : ""}`,
                  cause: new AggregateError([
                    Cause.squash(cause),
                    ...rollbackFailures.map((exit) => Cause.squash(exit.cause)),
                  ]),
                });
                return yield* Effect.failCause(
                  Cause.hasDies(cause) ||
                    Cause.hasInterrupts(cause) ||
                    Cause.hasDies(rollbackCause) ||
                    Cause.hasInterrupts(rollbackCause)
                    ? Cause.combine(
                        cause,
                        Cause.combine(rollbackCause, Cause.fail(incomplete)),
                      )
                    : Cause.fail(incomplete),
                );
              }
              return yield* Effect.failCause(cause);
            }),
          ),
        );
        if (backup) {
          transfer.reporter?.update("cleaning-up");
          yield* assertAccessible(
            transfer.assertDestinationActive,
            transfer.destination,
          );
          yield* io("rm", () =>
            fs.rm(backup, { recursive: true, force: true }),
          );
        }
      }),
    );

  const stageDestination = Effect.fn(function* (destination: string) {
    const backup = path.join(
      path.dirname(destination),
      `.${path.basename(destination)}.eden-transfer-${randomUUID()}`,
    );
    yield* io("rename", () => fs.rename(destination, backup));
    return backup;
  });

  const assertAccessible = (
    check: (() => Effect.Effect<void, Error>) | undefined,
    hostPath: string,
  ): Effect.Effect<void, FilesystemPathError> =>
    check
      ? check().pipe(
          Effect.mapError((cause) =>
            cause instanceof VolumeUnavailable ||
            cause instanceof VolumeIoFailed ||
            cause instanceof FilesystemAccessDenied ||
            cause instanceof FilesystemIoFailed
              ? cause
              : new FilesystemAccessDenied({
                  path: hostPath,
                  cause,
                  message: cause.message,
                }),
          ),
        )
      : Effect.void;

  const assertActive = Effect.fn(function* (
    transfer: TransferRequest | PreparedTransfer,
  ) {
    yield* assertAccessible(transfer.assertSourceActive, transfer.source);
    yield* assertAccessible(
      transfer.assertDestinationActive,
      transfer.destination,
    );
  });

  const copyEntry = Effect.fn(function* (transfer: PreparedTransfer) {
    const clock = yield* Clock.Clock;
    const { source, destination } = transfer;
    const sourceStats = yield* io("lstat", () => fs.lstat(source));
    const total = sourceStats.isFile() ? sourceStats.size : undefined;
    let completed = 0;
    let lastReport = 0;
    const report = () => {
      transfer.reporter?.update("copying", { completed, total, unit: "bytes" });
      lastReport = clock.currentTimeMillisUnsafe();
    };
    report();
    lastReport = Number.NEGATIVE_INFINITY;
    // fs.cp requires Promise callbacks; keep that conversion at this native edge.
    // @eden-effect-next-line domain-interpreter -- Native fs.cp filters require Promises; fs.cp awaits them before the volume lease releases.
    const runFilter = Effect.runPromiseWith(yield* Effect.context<never>());
    yield* fromPromise(
      (signal) =>
        fs.cp(source, destination, {
          recursive: true,
          verbatimSymlinks: true,
          filter: (entrySource, entryDestination) =>
            runFilter(
              Effect.gen(function* () {
                yield* Effect.sync(() => signal.throwIfAborted());
                yield* assertActive(transfer);
                if (transfer.reporter) {
                  const stats = yield* io("lstat", () => fs.lstat(entrySource));
                  if (stats.isFile()) {
                    yield* fromPromise(
                      () =>
                        pipeline(
                          createReadStream(entrySource, {
                            highWaterMark: 1024 * 1024,
                          }),
                          async function* (chunks) {
                            for await (const chunk of chunks) {
                              yield chunk;
                              completed += chunk.length;
                              if (
                                clock.currentTimeMillisUnsafe() - lastReport >=
                                100
                              )
                                report();
                            }
                          },
                          createWriteStream(entryDestination, {
                            flags: "wx",
                            mode: stats.mode,
                          }),
                          { signal },
                        ),
                      (cause) => nativeError("copy", cause),
                    );
                    yield* io("chmod", () =>
                      fs.chmod(entryDestination, stats.mode),
                    );
                    yield* assertActive(transfer);
                    yield* Effect.sync(() => signal.throwIfAborted());
                    if (clock.currentTimeMillisUnsafe() - lastReport >= 100)
                      report();
                    return false;
                  }
                }
                return true;
              }),
            ),
          errorOnExist: true,
          force: false,
        }),
      (cause) => nativeError("copy", cause),
    );
    yield* assertActive(transfer);
    report();
  });

  const pathExists = (hostPath: string) =>
    io("lstat", () => fs.lstat(hostPath)).pipe(
      Effect.as(true),
      Effect.catch((error) =>
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? Effect.succeed(false)
          : Effect.fail(error),
      ),
    );

  const resolveCanonicalPath = Effect.fn(function* (hostPath: string) {
    let existingPath = hostPath;
    const missingSegments: string[] = [];
    while (true) {
      const result = yield* Effect.result(
        io("realpath", () => fs.realpath(existingPath)),
      );
      if (Result.isSuccess(result))
        return path.resolve(result.success, ...missingSegments);
      const error = result.failure;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        return yield* Effect.fail(error);
      const parent = path.dirname(existingPath);
      if (parent === existingPath) return yield* Effect.fail(error);
      missingSegments.unshift(path.basename(existingPath));
      existingPath = parent;
    }
  });

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
