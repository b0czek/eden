import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { asError, fromPromise } from "../effects/io";
import type { OperationReporter } from "../operations/task";

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
    yield* runWithDestinationRollback(
      transfer,
      Effect.gen(function* () {
        yield* assertActive(transfer);
        transfer.reporter?.update("moving");
        yield* io(() => fs.rename(transfer.source, transfer.destination)).pipe(
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
    );
    if (copied) {
      yield* Effect.gen(function* () {
        yield* assertActive(transfer);
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
    const canonicalDestination = yield* resolveCanonicalPath(
      request.destination,
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
    const destinationExists = yield* pathExists(request.destination);
    if (destinationExists && !request.overwrite)
      return yield* Effect.fail(
        new Error(`Destination '${request.destinationLabel}' already exists`),
      );
    yield* assertActive(request);
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
        yield* assertActive(transfer);
        const backup = transfer.destinationExists
          ? yield* stageDestination(transfer.destination)
          : undefined;
        yield* restore(Effect.andThen(work, assertActive(transfer))).pipe(
          Effect.catchCause((cause) =>
            Effect.gen(function* () {
              transfer.reporter?.update("rolling-back");
              const rollbackErrors: Error[] = [];
              const attempt = (work: Effect.Effect<unknown, Error>) =>
                work.pipe(
                  Effect.catch((error) =>
                    Effect.sync(() => {
                      rollbackErrors.push(error);
                    }),
                  ),
                );
              yield* attempt(
                Effect.gen(function* () {
                  yield* transfer.assertDestinationActive?.() ?? Effect.void;
                  yield* io(() =>
                    fs.rm(transfer.destination, {
                      recursive: true,
                      force: true,
                    }),
                  );
                }),
              );
              if (backup)
                yield* attempt(
                  Effect.gen(function* () {
                    yield* transfer.assertDestinationActive?.() ?? Effect.void;
                    yield* io(() => fs.rename(backup, transfer.destination));
                  }),
                );
              if (rollbackErrors.length)
                return yield* Effect.fail(
                  new AggregateError(
                    [Cause.squash(cause), ...rollbackErrors],
                    "Filesystem transfer failed and rollback was incomplete",
                  ),
                );
              return yield* Effect.failCause(cause);
            }),
          ),
        );
        if (backup) {
          transfer.reporter?.update("cleaning-up");
          yield* transfer.assertDestinationActive?.() ?? Effect.void;
          yield* io(() => fs.rm(backup, { recursive: true, force: true }));
        }
      }),
    );

  const stageDestination = Effect.fn(function* (destination: string) {
    const backup = path.join(
      path.dirname(destination),
      `.${path.basename(destination)}.eden-transfer-${randomUUID()}`,
    );
    yield* io(() => fs.rename(destination, backup));
    return backup;
  });

  const assertActive = Effect.fn(function* (
    transfer: TransferRequest | PreparedTransfer,
  ) {
    yield* transfer.assertSourceActive?.() ?? Effect.void;
    yield* transfer.assertDestinationActive?.() ?? Effect.void;
  });

  const copyEntry = Effect.fn(function* (transfer: PreparedTransfer) {
    const { source, destination } = transfer;
    const sourceStats = yield* io(() => fs.lstat(source));
    const total = sourceStats.isFile() ? sourceStats.size : undefined;
    let completed = 0;
    let lastReport = 0;
    const report = () => {
      transfer.reporter?.update("copying", { completed, total, unit: "bytes" });
      lastReport = Date.now();
    };
    report();
    lastReport = 0;
    // fs.cp requires Promise callbacks; keep that conversion at this native edge.
    const runFilter = Effect.runPromiseWith(yield* Effect.context<never>());
    yield* fromPromise((signal) =>
      fs.cp(source, destination, {
        recursive: true,
        verbatimSymlinks: true,
        filter: (entrySource, entryDestination) =>
          runFilter(
            Effect.gen(function* () {
              yield* Effect.try({
                try: () => signal.throwIfAborted(),
                catch: asError,
              });
              yield* assertActive(transfer);
              if (transfer.reporter) {
                const stats = yield* io(() => fs.lstat(entrySource));
                if (stats.isFile()) {
                  yield* fromPromise(() =>
                    pipeline(
                      createReadStream(entrySource, {
                        highWaterMark: 1024 * 1024,
                      }),
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
                    ),
                  );
                  yield* io(() => fs.chmod(entryDestination, stats.mode));
                  yield* assertActive(transfer);
                  yield* Effect.try({
                    try: () => signal.throwIfAborted(),
                    catch: asError,
                  });
                  if (Date.now() - lastReport >= 100) report();
                  return false;
                }
              }
              return true;
            }),
          ),
        errorOnExist: true,
        force: false,
      }),
    );
    yield* assertActive(transfer);
    report();
  });

  const pathExists = (hostPath: string) =>
    io(() => fs.lstat(hostPath)).pipe(
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
      const result = yield* Effect.exit(io(() => fs.realpath(existingPath)));
      if (Exit.isSuccess(result))
        return path.resolve(result.value, ...missingSegments);
      const error = Cause.squash(result.cause);
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        return yield* Effect.fail(asError(error));
      const parent = path.dirname(existingPath);
      if (parent === existingPath) return yield* Effect.fail(asError(error));
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
