import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { inject, Lifecycle, scoped } from "tsyringe";
import { log } from "../logging";

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
  prepare?: (stagingDirectory: string) => Promise<void>;
}

/** Coordinates rollback-capable directory swaps on the apps filesystem. */
@scoped(Lifecycle.ContainerScoped)
export class PackageOperationCoordinator {
  private readonly root: string;
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(@inject("appsDirectory") appsDirectory: string) {
    this.root = path.join(appsDirectory, ".package-transactions");
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
    const entries = await fs.readdir(this.root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(this.root, entry.name);
      try {
        if (!(await this.exists(path.join(directory, "journal.json")))) {
          await fs.rm(directory, { recursive: true, force: true });
          continue;
        }
        const journal = await this.readJournal(directory);
        if (journal.state !== "committed")
          await this.rollback(directory, journal);
        await fs.rm(directory, { recursive: true, force: true });
      } catch (error) {
        log.error(
          `Failed to recover package transaction ${entry.name}:`,
          error,
        );
        throw error;
      }
    }
  }

  async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTail;
    let release!: () => void;
    this.mutationTail = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async execute(operations: PackageOperation[]): Promise<void> {
    if (operations.length === 0) return;
    const directory = path.join(this.root, randomUUID());
    await fs.mkdir(path.join(directory, "stages"), { recursive: true });
    await fs.mkdir(path.join(directory, "backups"), { recursive: true });

    const entries: TransactionEntry[] = operations.map((operation, index) => ({
      target: this.assertManagedPath(operation.target),
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

    try {
      for (const [index, operation] of operations.entries()) {
        const stage = entries[index].stage;
        if (operation.prepare && stage) {
          await fs.mkdir(stage, { recursive: true });
          await operation.prepare(stage);
        }
      }
      await this.writeJournal(directory, journal);
      journal.state = "applying";
      await this.writeJournal(directory, journal);

      for (const entry of journal.entries) {
        if (await this.exists(entry.target)) {
          await fs.rename(entry.target, entry.backup);
          entry.backedUp = true;
          await this.writeJournal(directory, journal);
        }
        if (entry.stage) {
          await fs.mkdir(path.dirname(entry.target), { recursive: true });
          await fs.rename(entry.stage, entry.target);
          entry.installed = true;
          await this.writeJournal(directory, journal);
        }
      }

      journal.state = "committed";
      await this.writeJournal(directory, journal);
      await fs.rm(directory, { recursive: true, force: true });
    } catch (error) {
      await this.rollback(directory, journal).catch((rollbackError) => {
        log.error("Package transaction rollback failed:", rollbackError);
      });
      await fs
        .rm(directory, { recursive: true, force: true })
        .catch(() => undefined);
      throw error;
    }
  }

  private async rollback(
    directory: string,
    journal: TransactionJournal,
  ): Promise<void> {
    for (const entry of [...journal.entries].reverse()) {
      const targetExists = await this.exists(entry.target);
      const backupExists = await this.exists(entry.backup);
      const stageExists = entry.stage ? await this.exists(entry.stage) : false;
      const inferredInstalled = !!entry.stage && !stageExists && targetExists;
      if (
        (entry.installed || inferredInstalled || backupExists) &&
        targetExists
      ) {
        await fs.rm(entry.target, { recursive: true, force: true });
      }
      if (backupExists) {
        await fs.mkdir(path.dirname(entry.target), { recursive: true });
        await fs.rename(entry.backup, entry.target);
      }
    }
    await fs.rm(path.join(directory, "stages"), {
      recursive: true,
      force: true,
    });
  }

  private assertManagedPath(target: string): string {
    const resolved = path.resolve(target);
    const relative = path.relative(path.dirname(this.root), resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(
        `Package operation target escapes the apps directory: ${target}`,
      );
    }
    return resolved;
  }

  private async readJournal(directory: string): Promise<TransactionJournal> {
    const value = JSON.parse(
      await fs.readFile(path.join(directory, "journal.json"), "utf-8"),
    ) as TransactionJournal;
    if (value.version !== 1 || !Array.isArray(value.entries)) {
      throw new Error("Unsupported package transaction journal");
    }
    for (const entry of value.entries) this.assertManagedPath(entry.target);
    return value;
  }

  private async writeJournal(
    directory: string,
    journal: TransactionJournal,
  ): Promise<void> {
    const target = path.join(directory, "journal.json");
    const temporary = `${target}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(journal), "utf-8");
    await fs.rename(temporary, target);
  }

  private async exists(target: string): Promise<boolean> {
    try {
      await fs.access(target);
      return true;
    } catch {
      return false;
    }
  }
}
