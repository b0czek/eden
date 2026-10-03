import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

interface TransferRequest {
  source: string;
  destination: string;
  destinationLabel: string;
  overwrite: boolean;
  assertSourceActive?: () => Promise<void>;
  assertDestinationActive?: () => Promise<void>;
}

interface PreparedTransfer {
  source: string;
  destination: string;
  destinationExists: boolean;
  assertSourceActive?: () => Promise<void>;
  assertDestinationActive?: () => Promise<void>;
}

export class FilesystemTransfer {
  async copy(request: TransferRequest): Promise<void> {
    const transfer = await this.prepare(request, "copy");
    await this.runWithDestinationRollback(transfer, () =>
      this.copyEntry(transfer),
    );
  }

  async move(request: TransferRequest): Promise<void> {
    const transfer = await this.prepare(request, "move");
    let copied = false;
    await this.runWithDestinationRollback(transfer, async () => {
      await this.assertActive(transfer);
      try {
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
    } catch (error) {
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
    await transfer.assertSourceActive?.();
    await transfer.assertDestinationActive?.();
  }

  private async copyEntry(transfer: PreparedTransfer): Promise<void> {
    const { source, destination } = transfer;
    const sourceRoots = (await fs.lstat(source)).isDirectory()
      ? [path.resolve(source), await fs.realpath(source)]
      : [];
    const internalLinks: { destination: string; target: string }[] = [];
    await fs.cp(source, destination, {
      recursive: true,
      verbatimSymlinks: true,
      filter: async (entrySource, entryDestination) => {
        await this.assertActive(transfer);
        if ((await fs.lstat(entrySource)).isSymbolicLink()) {
          const target = await fs.readlink(entrySource);
          if (path.isAbsolute(target)) {
            const sourceRoot = sourceRoots.find(
              (root) => root === target || this.isPathWithin(root, target),
            );
            if (sourceRoot) {
              const copiedTarget = path.join(
                destination,
                path.relative(sourceRoot, target),
              );
              internalLinks.push({
                destination: entryDestination,
                target:
                  path.relative(path.dirname(entryDestination), copiedTarget) ||
                  ".",
              });
            }
          }
        }
        return true;
      },
      errorOnExist: true,
      force: false,
    });
    // Relative and external absolute links retain their original text. Internal
    // absolute links become relative so they survive removal of the source tree.
    for (const link of internalLinks) {
      await this.assertActive(transfer);
      await fs.unlink(link.destination);
      await fs.symlink(link.target, link.destination);
    }
    await this.assertActive(transfer);
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
