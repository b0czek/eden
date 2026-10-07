import type { OperationReporter } from "../operations/OperationTask";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import * as path from "node:path";

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

export class FilesystemTransfer {
  async copy(request: TransferRequest): Promise<void> {
    request.reporter?.signal?.throwIfAborted();
    request.reporter?.update("preparing-copy");
    const transfer = await this.prepare(request, "copy");
    await this.runWithDestinationRollback(transfer, () =>
      this.copyEntry(transfer),
    );
  }

  async move(request: TransferRequest): Promise<void> {
    request.reporter?.update("preparing-move");
    const transfer = await this.prepare(request, "move");
    let copied = false;
    await this.runWithDestinationRollback(transfer, async () => {
      await this.assertActive(transfer);
      try {
        transfer.reporter?.update("moving");
        await fs.rename(transfer.source, transfer.destination);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
        await this.copyEntry(transfer);
        copied = true;
      }
    });
    if (copied) {
      // The completed destination must survive an incomplete source deletion.
      try {
        await this.assertActive(transfer);
        transfer.reporter?.update("removing-source");
        await fs.rm(transfer.source, { recursive: true, force: false });
      } catch (error) {
        throw new Error(
          "Move copied the destination but could not completely remove the source",
          { cause: error },
        );
      }
    }
  }

  private async prepare(
    request: TransferRequest,
    operation: "copy" | "move",
  ): Promise<PreparedTransfer> {
    const sourceStats = await fs.stat(request.source);
    const canonicalSource = await fs.realpath(request.source);
    const canonicalDestination = await this.resolveCanonicalPath(
      request.destination,
    );

    if (canonicalSource === canonicalDestination) {
      throw new Error("Source and destination must be different");
    }
    if (
      sourceStats.isDirectory() &&
      this.isPathWithin(canonicalSource, canonicalDestination)
    ) {
      throw new Error(
        `Cannot ${operation} a directory into itself or a descendant`,
      );
    }
    if (this.isPathWithin(canonicalDestination, canonicalSource)) {
      throw new Error("Source and destination paths overlap");
    }

    const destinationExists = await this.pathExists(request.destination);
    if (destinationExists && !request.overwrite) {
      throw new Error(
        `Destination '${request.destinationLabel}' already exists`,
      );
    }

    await this.assertActive(request);
    await fs.mkdir(path.dirname(request.destination), { recursive: true });
    return {
      reporter: request.reporter,
      source: request.source,
      destination: request.destination,
      destinationExists,
      assertSourceActive: request.assertSourceActive,
      assertDestinationActive: request.assertDestinationActive,
    };
  }

  private async runWithDestinationRollback(
    transfer: PreparedTransfer,
    operation: () => Promise<void>,
  ): Promise<void> {
    await this.assertActive(transfer);
    const backup = transfer.destinationExists
      ? await this.stageDestination(transfer.destination)
      : undefined;

    try {
      await operation();
      transfer.reporter?.signal?.throwIfAborted();
    } catch (error) {
      transfer.reporter?.update("rolling-back");
      const rollbackErrors: unknown[] = [];
      try {
        await transfer.assertDestinationActive?.();
        await fs.rm(transfer.destination, { recursive: true, force: true });
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

      if (rollbackErrors.length > 0) {
        throw new AggregateError(
          [error, ...rollbackErrors],
          "Filesystem transfer failed and rollback was incomplete",
        );
      }
      throw error;
    }

    if (backup) {
      transfer.reporter?.update("cleaning-up");
      await transfer.assertDestinationActive?.();
      await fs.rm(backup, { recursive: true, force: true });
    }
  }

  private async stageDestination(destination: string): Promise<string> {
    const backup = path.join(
      path.dirname(destination),
      `.${path.basename(destination)}.eden-transfer-${randomUUID()}`,
    );
    await fs.rename(destination, backup);
    return backup;
  }

  private async assertActive(transfer: TransferRequest | PreparedTransfer) {
    transfer.reporter?.signal?.throwIfAborted();
    await transfer.assertSourceActive?.();
    await transfer.assertDestinationActive?.();
    transfer.reporter?.signal?.throwIfAborted();
  }

  private async copyEntry(transfer: PreparedTransfer): Promise<void> {
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
        await this.assertActive(transfer);
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
              { signal: transfer.reporter.signal },
            );
            await fs.chmod(entryDestination, stats.mode);
            await this.assertActive(transfer);
            if (Date.now() - lastReport >= 100) report();
            return false;
          }
        }
        return true;
      },
      errorOnExist: true,
      force: false,
    });
    await this.assertActive(transfer);
    report();
  }

  private async pathExists(hostPath: string): Promise<boolean> {
    try {
      await fs.lstat(hostPath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  private async resolveCanonicalPath(hostPath: string): Promise<string> {
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

  private isPathWithin(parentPath: string, candidatePath: string): boolean {
    const relative = path.relative(parentPath, candidatePath);
    return (
      relative !== "" &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    );
  }
}
