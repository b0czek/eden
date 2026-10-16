import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";
import { asError, fromPromise } from "../effects/io";
import { log } from "../logging";
import type { OperationReporter } from "../operations/task";

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
export interface PackageOperation {
  target: string;
  prepare?: (stagingDirectory: string) => Effect.Effect<void, Error>;
}

export const createPackageTransactions = ({
  appsDirectory,
}: {
  appsDirectory: string;
}) => {
  const root = path.join(appsDirectory, ".package-transactions");
  const mutationLock = Semaphore.makeUnsafe(1);
  const initialize = Effect.fn(function* () {
    yield* fromPromise(() => fs.mkdir(root, { recursive: true }));
    const entries = yield* fromPromise(() =>
      fs.readdir(root, { withFileTypes: true }),
    );
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(root, entry.name);
      yield* Effect.catch(
        Effect.gen(function* () {
          if (!(yield* exists(path.join(directory, "journal.json")))) {
            yield* fromPromise(() =>
              fs.rm(directory, { recursive: true, force: true }),
            );
            return;
          }
          const journal = yield* readJournal(directory);
          if (journal.state !== "committed")
            yield* rollback(directory, journal);
          yield* fromPromise(() =>
            fs.rm(directory, { recursive: true, force: true }),
          );
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
  function runExclusive<A, E>(
    operation: () => Effect.Effect<A, E>,
    reporter?: OperationReporter,
  ) {
    return Effect.suspend(() => {
      reporter?.update("waiting-for-package-lock");
      return mutationLock.withPermit(
        Effect.uninterruptible(Effect.suspend(operation)),
      );
    });
  }
  const execute = Effect.fn(function* (
    operations: PackageOperation[],
    reporter?: OperationReporter,
  ) {
    reporter?.update("staging-transaction");
    if (operations.length === 0) return;
    const directory = path.join(root, randomUUID());
    yield* fromPromise(() =>
      fs.mkdir(path.join(directory, "stages"), { recursive: true }),
    );
    yield* fromPromise(() =>
      fs.mkdir(path.join(directory, "backups"), { recursive: true }),
    );
    const entries: TransactionEntry[] = operations.map((operation, index) => ({
      target: assertManagedPath(operation.target),
      stage: operation.prepare
        ? path.join(directory, "stages", String(index))
        : undefined,
      backup: path.join(directory, "backups", String(index)),
      backedUp: false,
      installed: false,
    }));
    const journal: TransactionJournal = {
      version: 1,
      state: "prepared",
      entries,
    };
    return yield* Effect.catchCause(
      Effect.gen(function* () {
        for (const [index, operation] of operations.entries()) {
          const stage = entries[index].stage;
          if (operation.prepare && stage) {
            yield* fromPromise(() => fs.mkdir(stage, { recursive: true }));
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
            yield* fromPromise(() => fs.rename(entry.target, entry.backup));
            entry.backedUp = true;
            yield* writeJournal(directory, journal);
          }
          const stage = entry.stage;
          if (stage) {
            yield* fromPromise(() =>
              fs.mkdir(path.dirname(entry.target), { recursive: true }),
            );
            yield* fromPromise(() => fs.rename(stage, entry.target));
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
        yield* fromPromise(() =>
          fs.rm(directory, { recursive: true, force: true }),
        );
      }),
      (error) =>
        Effect.gen(function* () {
          reporter?.update("rolling-back-transaction");
          yield* Effect.catch(rollback(directory, journal), (rollbackError) =>
            Effect.sync(() => {
              log.error("Package transaction rollback failed:", rollbackError);
            }),
          );
          yield* fromPromise(() =>
            fs
              .rm(directory, { recursive: true, force: true })
              .catch(() => undefined),
          );
          return yield* Effect.failCause(error);
        }),
    );
  }, Effect.uninterruptible);
  const rollback = Effect.fn(function* (
    directory: string,
    journal: TransactionJournal,
  ) {
    for (const entry of [...journal.entries].reverse()) {
      const targetExists = yield* exists(entry.target);
      const backupExists = yield* exists(entry.backup);
      const stageExists = entry.stage ? yield* exists(entry.stage) : false;
      const inferredInstalled = !!entry.stage && !stageExists && targetExists;
      if (
        (entry.installed || inferredInstalled || backupExists) &&
        targetExists
      ) {
        yield* fromPromise(() =>
          fs.rm(entry.target, { recursive: true, force: true }),
        );
      }
      if (backupExists) {
        yield* fromPromise(() =>
          fs.mkdir(path.dirname(entry.target), { recursive: true }),
        );
        yield* fromPromise(() => fs.rename(entry.backup, entry.target));
      }
    }
    yield* fromPromise(() =>
      fs.rm(path.join(directory, "stages"), {
        recursive: true,
        force: true,
      }),
    );
  });
  function assertManagedPath(target: string): string {
    const resolved = path.resolve(target);
    const relative = path.relative(path.dirname(root), resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(
        `Package operation target escapes the apps directory: ${target}`,
      );
    }
    return resolved;
  }
  const readJournal = Effect.fn(function* (directory: string) {
    const contents = yield* fromPromise(() =>
      fs.readFile(path.join(directory, "journal.json"), "utf-8"),
    );
    const value = (yield* Effect.try({
      try: () => JSON.parse(contents),
      catch: asError,
    })) as TransactionJournal;
    if (value.version !== 1 || !Array.isArray(value.entries)) {
      return yield* Effect.fail(
        new Error("Unsupported package transaction journal"),
      );
    }
    for (const entry of value.entries)
      yield* Effect.try({
        try: () => assertManagedPath(entry.target),
        catch: asError,
      });
    return value;
  });
  const writeJournal = Effect.fn(function* (
    directory: string,
    journal: TransactionJournal,
  ) {
    const target = path.join(directory, "journal.json");
    const temporary = `${target}.tmp`;
    yield* fromPromise(() =>
      fs.writeFile(temporary, JSON.stringify(journal), "utf-8"),
    );
    yield* fromPromise(() => fs.rename(temporary, target));
  });
  const exists = Effect.fn(function* (target: string) {
    return yield* Effect.catch(
      Effect.gen(function* () {
        yield* fromPromise(() => fs.access(target));
        return true;
      }),
      (_error) =>
        Effect.sync(() => {
          return false;
        }),
    );
  });
  return { initialize, runExclusive, execute };
};
export type PackageTransactions = ReturnType<typeof createPackageTransactions>;
