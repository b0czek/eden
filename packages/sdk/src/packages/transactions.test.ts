import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as Effect from "effect/Effect";
import { fromPromise } from "../effects/io";
import {
  createPackageTransactions,
  type PackageTransactions,
} from "./transactions";

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
    coordinator = createPackageTransactions({ appsDirectory: apps });
    await Effect.runPromise(coordinator.initialize());
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
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
      coordinator.runExclusive(() =>
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
      coordinator.runExclusive(() =>
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
