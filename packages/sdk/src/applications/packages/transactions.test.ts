import * as nativeFs from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import {
  buildService,
  createEffectRuntime,
} from "../../../tests/support/effect-runtime";
import { fromPromise } from "../../core/effects/io";
import { log } from "../../platform/logging/logger";
import { AppsDirectory } from "../../runtime/inputs";
import { PackageRollbackError } from "./errors";
import { PackageTransactions, PackageTransactionsLive } from "./transactions";

const serviceEffects = createEffectRuntime();
afterAll(() => serviceEffects.dispose());

describe("PackageTransactions", () => {
  let root: string;
  let apps: string;
  let coordinator: PackageTransactions;

  beforeEach(async () => {
    root = await fs.mkdtemp(
      path.join(os.tmpdir(), "eden-package-transaction-"),
    );
    apps = path.join(root, "apps");
    await fs.mkdir(apps, { recursive: true });
    coordinator = serviceEffects.acquireSync(
      buildService(PackageTransactions, PackageTransactionsLive).pipe(
        Effect.provideService(AppsDirectory, apps),
      ),
    );
    await Effect.runPromise(coordinator.initialize());
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("keeps the committed package when backup deletion fails and retries cleanup on recovery", async () => {
    const target = path.join(apps, "com.example.app");
    const locked = path.join(target, "locked");
    const recoveryRoot = path.join(apps, ".package-transactions");
    await fs.mkdir(locked, { recursive: true });
    await fs.writeFile(path.join(target, "version"), "old");
    await fs.writeFile(path.join(locked, "content"), "original");
    await fs.chmod(locked, 0o555);
    const warning = jest.spyOn(log, "warn").mockImplementation(() => {});
    try {
      await expect(
        Effect.runPromise(
          coordinator.execute([
            {
              target,
              prepare: (stage) =>
                fromPromise(() =>
                  fs.writeFile(path.join(stage, "version"), "new"),
                ),
            },
          ]),
        ),
      ).resolves.toBeUndefined();
      await expect(
        fs.readFile(path.join(target, "version"), "utf8"),
      ).resolves.toBe("new");
      const directories = await fs.readdir(recoveryRoot);
      expect(directories).toHaveLength(1);
      const directory = path.join(recoveryRoot, directories[0]);
      const journal = JSON.parse(
        await fs.readFile(path.join(directory, "journal.json"), "utf8"),
      );
      expect(journal.state).toBe("committed");
      expect(warning).toHaveBeenCalledWith(
        expect.stringContaining(directory),
        expect.objectContaining({
          cause: expect.objectContaining({ code: "EACCES" }),
        }),
      );
      await Effect.runPromise(coordinator.initialize());
      await expect(
        fs.readFile(path.join(target, "version"), "utf8"),
      ).resolves.toBe("new");
      await fs.chmod(path.join(directory, "backups/0/locked"), 0o755);
      await Effect.runPromise(coordinator.initialize());
      await expect(fs.readdir(recoveryRoot)).resolves.toEqual([]);
      await expect(
        fs.readFile(path.join(target, "version"), "utf8"),
      ).resolves.toBe("new");
    } finally {
      warning.mockRestore();
      await fs.chmod(locked, 0o755).catch(() => undefined);
      for (const directory of await fs.readdir(recoveryRoot))
        await fs
          .chmod(path.join(recoveryRoot, directory, "backups/0/locked"), 0o755)
          .catch(() => undefined);
    }
  });

  it("retains recoverable originals and both failures when rollback cannot finish", async () => {
    const blockedParent = path.join(apps, "protected");
    const targets = [
      path.join(blockedParent, "first"),
      path.join(apps, "second"),
    ];
    const failure = new Error("Commit rejected");
    try {
      for (const target of targets) {
        await fs.mkdir(target, { recursive: true });
        await fs.writeFile(
          path.join(target, "content"),
          `original ${path.basename(target)}`,
        );
      }
      const transactions = coordinator;
      const exit = await Effect.runPromiseExit(
        transactions.execute(
          targets.map((target) => ({
            target,
            prepare: (stage) =>
              fromPromise(() =>
                fs.writeFile(path.join(stage, "content"), "replacement"),
              ),
          })),
          {
            commit: Effect.void,
            update: (phase) => {
              if (phase === "committing-transaction") {
                nativeFs.chmodSync(blockedParent, 0o555);
                throw failure;
              }
            },
          },
        ),
      );
      if (!Exit.isFailure(exit))
        throw new Error("Expected transaction failure");
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.findDefect(exit.cause)).toMatchObject({ success: failure });
      const error = exit.cause.reasons
        .filter(Cause.isFailReason)
        .map((reason) => reason.error)
        .find((error) => error instanceof PackageRollbackError);
      expect(error).toBeInstanceOf(PackageRollbackError);
      expect(error).toMatchObject({
        cause: failure,
        rollbackCause: { cause: expect.objectContaining({ code: "EACCES" }) },
      });
      const recoveryRoot = path.join(apps, ".package-transactions");
      const directories = await fs.readdir(recoveryRoot);
      expect(directories).toHaveLength(1);
      const directory = path.join(recoveryRoot, directories[0]);
      expect((error as Error).message).toContain(directory);
      expect((error as Error).message).toContain(failure.message);
      expect((error as Error).message).toContain("EACCES");
      await expect(
        fs.readFile(path.join(directory, "backups/0/content"), "utf8"),
      ).resolves.toBe("original first");
      await expect(
        fs.readFile(path.join(directory, "journal.json"), "utf8"),
      ).resolves.toContain('"applying"');
      await expect(
        fs.readFile(path.join(targets[1], "content"), "utf8"),
      ).resolves.toBe("original second");

      await fs.chmod(blockedParent, 0o755);
      await Effect.runPromise(
        serviceEffects
          .acquireSync(
            buildService(PackageTransactions, PackageTransactionsLive).pipe(
              Effect.provideService(AppsDirectory, apps),
            ),
          )
          .initialize(),
      );
      for (const target of targets)
        await expect(
          fs.readFile(path.join(target, "content"), "utf8"),
        ).resolves.toBe(`original ${path.basename(target)}`);
      await expect(fs.readdir(recoveryRoot)).resolves.toEqual([]);
    } finally {
      await fs.chmod(blockedParent, 0o755).catch(() => undefined);
    }
  });

  it("rolls back an applied swap when a later operation fails", async () => {
    const target = path.join(apps, "com.example.app");
    await fs.mkdir(target);
    await fs.writeFile(path.join(target, "version"), "old");
    await fs.writeFile(path.join(apps, "blocker"), "not a directory");

    await expect(
      Effect.runPromise(
        coordinator.execute([
          {
            target,
            prepare: (stage) =>
              fromPromise(() =>
                fs.writeFile(path.join(stage, "version"), "new"),
              ),
          },
          {
            target: path.join(apps, "blocker", "child"),
            prepare: (stage) =>
              fromPromise(() => fs.writeFile(path.join(stage, "value"), "new")),
          },
        ]),
      ),
    ).rejects.toThrow();

    await expect(
      fs.readFile(path.join(target, "version"), "utf-8"),
    ).resolves.toBe("old");
  });

  it("recovers a crash between filesystem swaps and journal updates", async () => {
    const transaction = path.join(apps, ".package-transactions", "interrupted");
    const target = path.join(apps, "com.example.app");
    const backup = path.join(transaction, "backups", "0");
    const stage = path.join(transaction, "stages", "0");
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, "version"), "new");
    await fs.mkdir(backup, { recursive: true });
    await fs.writeFile(path.join(backup, "version"), "old");
    await fs.writeFile(
      path.join(transaction, "journal.json"),
      JSON.stringify({
        version: 1,
        state: "applying",
        entries: [
          {
            target,
            stage,
            backup,
            backedUp: false,
            installed: false,
          },
        ],
      }),
    );

    await Effect.runPromise(coordinator.initialize());

    await expect(
      fs.readFile(path.join(target, "version"), "utf-8"),
    ).resolves.toBe("old");
    await expect(fs.access(transaction)).rejects.toThrow();
  });

  it("serializes mutation callbacks through their registry updates", async () => {
    let unblockFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      unblockFirst = resolve;
    });
    let firstStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const order: string[] = [];

    const first = Effect.runPromise(
      coordinator.runExclusive(
        Effect.gen(function* () {
          order.push("first filesystem swap");
          firstStarted();
          yield* fromPromise(() => firstBlocked);
          order.push("first registry update");
        }),
      ),
    );
    await started;
    const second = Effect.runPromise(
      coordinator.runExclusive(
        Effect.sync(() => {
          order.push("second filesystem swap");
        }),
      ),
    );

    await Promise.resolve();
    expect(order).toEqual(["first filesystem swap"]);
    unblockFirst();
    await Promise.all([first, second]);
    expect(order).toEqual([
      "first filesystem swap",
      "first registry update",
      "second filesystem swap",
    ]);
  });
});
