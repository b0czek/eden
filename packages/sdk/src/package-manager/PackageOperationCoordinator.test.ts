import "reflect-metadata";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { PackageOperationCoordinator } from "./PackageOperationCoordinator";

describe("PackageOperationCoordinator", () => {
  let root: string;
  let apps: string;
  let coordinator: PackageOperationCoordinator;

  beforeEach(async () => {
    root = await fs.mkdtemp(
      path.join(os.tmpdir(), "eden-package-transaction-"),
    );
    apps = path.join(root, "apps");
    await fs.mkdir(apps, { recursive: true });
    coordinator = new PackageOperationCoordinator(apps);
    await coordinator.initialize();
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
      coordinator.execute([
        {
          target,
          prepare: async (stage) => {
            await fs.writeFile(path.join(stage, "version"), "new");
          },
        },
        {
          target: path.join(apps, "blocker", "child"),
          prepare: async (stage) => {
            await fs.writeFile(path.join(stage, "value"), "new");
          },
        },
      ]),
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

    await coordinator.initialize();

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

    const first = coordinator.runExclusive(async () => {
      order.push("first filesystem swap");
      firstStarted();
      await firstBlocked;
      order.push("first registry update");
    });
    await started;
    const second = coordinator.runExclusive(async () => {
      order.push("second filesystem swap");
    });

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
