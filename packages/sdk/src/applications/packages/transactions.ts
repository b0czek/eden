import { randomUUID } from "node:crypto";
import * as path from "node:path";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import { asError } from "../../core/effects/io";
import type { OperationReporter } from "../../core/operations/task";
import { isPathWithin } from "../../platform/filesystem/lexical-path";
import { io } from "../../platform/filesystem/native-io";
import { log } from "../../platform/logging/logger";
import { AppsDirectory } from "../../runtime/inputs";
import {
  PackageJournalError,
  PackageRollbackError,
  type PackageTransactionFailure,
} from "./errors";

export interface PackageTransactions {
  initialize: () => Effect.Effect<void, PackageTransactionFailure>;
  runExclusive: <A, E, R>(
    operation: Effect.Effect<A, E, R>,
    reporter?: OperationReporter,
  ) => Effect.Effect<A, E, R>;
  execute: <E = never>(
    operations: PackageOperation<E>[],
    reporter?: OperationReporter | undefined,
  ) => Effect.Effect<void, E | PackageTransactionFailure>;
}

export const PackageTransactions = Context.Service<
  "eden/PackageTransactions",
  PackageTransactions
>("eden/PackageTransactions");

interface TransactionEntry {
  target: string;
  stage?: string;
  backup: string;
  backedUp: boolean;
  installed: boolean;
}
interface TransactionJournal {
  version: 1;
  state: "prepared" | "applying" | "committed";
  entries: TransactionEntry[];
}
export interface PackageOperation<E = never> {
  target: string;
  prepare?: (stagingDirectory: string) => Effect.Effect<void, E>;
}

export const PackageTransactionsLive = Layer.effect(
  PackageTransactions,
  Effect.gen(function* () {
    const appsDirectory = yield* AppsDirectory;
    const root = path.join(appsDirectory, ".package-transactions");
    const mutationLock = Semaphore.makeUnsafe(1);
    const initialize = Effect.fn(function* () {
      yield* io.mkdir(root, { recursive: true });
      const entries = yield* io.readdir(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const directory = path.join(root, entry.name);
        yield* Effect.catch(
          Effect.gen(function* () {
            if (!(yield* exists(path.join(directory, "journal.json")))) {
              yield* io.rm(directory, { recursive: true, force: true });
              return;
            }
            const journal = yield* readJournal(directory);
            if (journal.state === "committed") {
              yield* cleanupCommitted(directory);
              return;
            }
            yield* rollback(directory, journal);
            yield* io.rm(directory, { recursive: true, force: true });
          }),
          (error) =>
            Effect.gen(function* () {
              log.error(
                `Failed to recover package transaction ${entry.name}:`,
                error,
              );
              return yield* Effect.fail(error);
            }),
        );
      }
    });
    function runExclusive<A, E, R>(
      operation: Effect.Effect<A, E, R>,
      reporter?: OperationReporter,
    ) {
      return Effect.suspend(() => {
        reporter?.update("waiting-for-package-lock");
        return mutationLock.withPermit(Effect.uninterruptible(operation));
      });
    }
    const execute = Effect.fn(function* <E = never>(
      operations: PackageOperation<E>[],
      reporter?: OperationReporter,
    ) {
      reporter?.update("staging-transaction");
      if (operations.length === 0) return;
      const directory = path.join(root, randomUUID());
      yield* io.mkdir(path.join(directory, "stages"), { recursive: true });
      yield* io.mkdir(path.join(directory, "backups"), { recursive: true });
      const entries: TransactionEntry[] = operations.map(
        (operation, index) => ({
          target: assertManagedPath(operation.target),
          stage: operation.prepare
            ? path.join(directory, "stages", String(index))
            : undefined,
          backup: path.join(directory, "backups", String(index)),
          backedUp: false,
          installed: false,
        }),
      );
      const journal: TransactionJournal = {
        version: 1,
        state: "prepared",
        entries,
      };
      yield* Effect.catchCause(
        Effect.gen(function* () {
          for (const [index, operation] of operations.entries()) {
            const stage = entries[index].stage;
            if (operation.prepare && stage) {
              yield* io.mkdir(stage, { recursive: true });
              yield* operation.prepare(stage);
            }
          }
          yield* writeJournal(directory, journal);
          journal.state = "applying";
          yield* writeJournal(directory, journal);
          reporter?.update("applying-transaction");
          let completed = 0;
          for (const entry of journal.entries) {
            if (yield* exists(entry.target)) {
              yield* io.rename(entry.target, entry.backup);
              entry.backedUp = true;
              yield* writeJournal(directory, journal);
            }
            const stage = entry.stage;
            if (stage) {
              yield* io.mkdir(path.dirname(entry.target), { recursive: true });
              yield* io.rename(stage, entry.target);
              entry.installed = true;
              yield* writeJournal(directory, journal);
            }
            reporter?.update("applying-transaction", {
              completed: ++completed,
              total: journal.entries.length,
              unit: "packages",
            });
          }
          reporter?.update("committing-transaction");
          journal.state = "committed";
          yield* writeJournal(directory, journal);
        }),
        (error) =>
          Effect.gen(function* () {
            reporter?.update("rolling-back-transaction");
            yield* Effect.catchCause(
              rollback(directory, journal),
              (rollbackCause) => {
                const failure = asError(Cause.squash(error));
                const rollbackFailure = asError(Cause.squash(rollbackCause));
                const rollbackError = new PackageRollbackError({
                  directory,
                  message: `Package transaction failed: ${failure.message}. Rollback failed: ${rollbackFailure.message}. Recovery files retained at ${directory}`,
                  cause: failure,
                  rollbackCause: rollbackFailure,
                });
                return Cause.hasDies(error) ||
                  Cause.hasInterrupts(error) ||
                  Cause.hasDies(rollbackCause) ||
                  Cause.hasInterrupts(rollbackCause)
                  ? Effect.failCause(
                      Cause.combine(
                        error,
                        Cause.combine(rollbackCause, Cause.fail(rollbackError)),
                      ),
                    )
                  : Effect.fail(rollbackError);
              },
            );
            yield* io
              .rm(directory, { recursive: true, force: true })
              .pipe(Effect.catch(() => Effect.void));
            return yield* Effect.failCause(error);
          }),
      );
      yield* cleanupCommitted(directory);
    }, Effect.uninterruptible);
    const cleanupCommitted = Effect.fn(function* (directory: string) {
      yield* Effect.gen(function* () {
        // Keep the committed journal until all disposable package data is gone.
        for (const name of ["backups", "stages"])
          yield* io.rm(path.join(directory, name), {
            recursive: true,
            force: true,
          });
        yield* io.rm(directory, { recursive: true, force: true });
      }).pipe(
        Effect.catch((error) =>
          Effect.sync(() =>
            log.warn(
              `Failed to clean committed package transaction; cleanup will be retried on startup at ${directory}:`,
              error,
            ),
          ),
        ),
      );
    });
    const rollback = Effect.fn(function* (
      directory: string,
      journal: TransactionJournal,
    ) {
      for (const entry of [...journal.entries].reverse()) {
        const targetExists = yield* exists(entry.target);
        const backupExists = yield* exists(entry.backup);
        const stageExists = entry.stage ? yield* exists(entry.stage) : false;
        const inferredInstalled = !!entry.stage && !stageExists && targetExists;
        // A previous rollback may already have restored a recorded backup.
        if (
          (backupExists ||
            (!entry.backedUp && (entry.installed || inferredInstalled))) &&
          targetExists
        ) {
          yield* io.rm(entry.target, { recursive: true, force: true });
        }
        if (backupExists) {
          if (!entry.backedUp) {
            entry.backedUp = true;
            yield* writeJournal(directory, journal);
          }
          yield* io.mkdir(path.dirname(entry.target), { recursive: true });
          yield* io.rename(entry.backup, entry.target);
        }
      }
      yield* io.rm(path.join(directory, "stages"), {
        recursive: true,
        force: true,
      });
    });
    function assertManagedPath(target: string): string {
      const resolved = path.resolve(target);
      if (!isPathWithin(path.dirname(root), resolved, { allowRoot: false })) {
        throw new Error(
          `Package operation target escapes the apps directory: ${target}`,
        );
      }
      return resolved;
    }
    const readJournal = Effect.fn(function* (directory: string) {
      const contents = yield* io.readFile(
        path.join(directory, "journal.json"),
        "utf-8",
      );
      const value = (yield* Effect.try({
        try: () => JSON.parse(contents),
        catch: (cause) =>
          new PackageJournalError({
            directory,
            message: "Invalid package transaction journal",
            cause,
          }),
      })) as TransactionJournal;
      if (value.version !== 1 || !Array.isArray(value.entries)) {
        return yield* Effect.fail(
          new PackageJournalError({
            directory,
            message: "Unsupported package transaction journal",
          }),
        );
      }
      for (const entry of value.entries)
        yield* Effect.try({
          try: () => assertManagedPath(entry.target),
          catch: (cause) =>
            new PackageJournalError({
              directory,
              message: asError(cause).message,
              cause,
            }),
        });
      return value;
    });
    const writeJournal = Effect.fn(function* (
      directory: string,
      journal: TransactionJournal,
    ) {
      yield* io.writeFileAtomic(
        path.join(directory, "journal.json"),
        JSON.stringify(journal),
        "utf-8",
      );
    });
    const exists = Effect.fn(function* (target: string) {
      return yield* Effect.catch(
        Effect.gen(function* () {
          yield* io.access(target);
          return true;
        }),
        (error) =>
          ["ENOENT", "ENOTDIR"].includes(error.code ?? "")
            ? Effect.succeed(false)
            : Effect.fail(error),
      );
    });
    return { initialize, runExclusive, execute };
  }),
);
