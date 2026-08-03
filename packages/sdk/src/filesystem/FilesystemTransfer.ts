import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

interface TransferRequest {
  source: string;
  destination: string;
  destinationLabel: string;
  overwrite: boolean;
}

interface PreparedTransfer {
  source: string;
  destination: string;
  destinationExists: boolean;
}

export class FilesystemTransfer {
  async copy(request: TransferRequest): Promise<void> {
    const transfer = await this.prepare(request, "copy");
    await this.runWithDestinationRollback(transfer, () =>
      this.copyEntry(transfer.source, transfer.destination),
    );
  }

  async move(request: TransferRequest): Promise<void> {
    const transfer = await this.prepare(request, "move");
    await this.runWithDestinationRollback(transfer, async () => {
      try {
        await fs.rename(transfer.source, transfer.destination);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
        await this.copyEntry(transfer.source, transfer.destination);
        await fs.rm(transfer.source, { recursive: true, force: true });
      }
    });
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

    await fs.mkdir(path.dirname(request.destination), { recursive: true });
    return {
      source: request.source,
      destination: request.destination,
      destinationExists,
    };
  }

  private async runWithDestinationRollback(
    transfer: PreparedTransfer,
    operation: () => Promise<void>,
  ): Promise<void> {
    const backup = transfer.destinationExists
      ? await this.stageDestination(transfer.destination)
      : undefined;

    try {
      await operation();
    } catch (error) {
      const rollbackErrors: unknown[] = [];
      try {
        await fs.rm(transfer.destination, { recursive: true, force: true });
      } catch (cleanupError) {
        rollbackErrors.push(cleanupError);
      }

      if (backup) {
        try {
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

  private async copyEntry(source: string, destination: string): Promise<void> {
    await fs.cp(source, destination, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
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
