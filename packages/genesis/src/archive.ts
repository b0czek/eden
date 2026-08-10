import { spawn } from "node:child_process";
import * as crypto from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import type { PackageManifest } from "@edenapp/types";
import * as tar from "tar";
import { validatePackageManifestObject } from "./manifest";

export const ARCHIVE_FORMAT_VERSION = 1;
const MAX_METADATA_LENGTH = 1024 * 1024;

export interface ArchiveMetadata {
  version: number;
  checksum: string;
  created: string;
  manifest: PackageManifest;
}

export async function readArchiveMetadata(edenitePath: string): Promise<{
  metadata: ArchiveMetadata;
  payloadOffset: number;
}> {
  const file = await fs.open(edenitePath, "r");
  try {
    const lengthBuffer = Buffer.alloc(4);
    const { bytesRead } = await file.read(lengthBuffer, 0, 4, 0);
    if (bytesRead !== 4) {
      throw new Error("Invalid .edenite file: missing metadata length");
    }
    const metadataLength = lengthBuffer.readUInt32BE(0);
    if (metadataLength === 0 || metadataLength > MAX_METADATA_LENGTH) {
      throw new Error("Invalid .edenite file: unsafe metadata length");
    }
    const metadataBuffer = Buffer.alloc(metadataLength);
    const metadataRead = await file.read(metadataBuffer, 0, metadataLength, 4);
    if (metadataRead.bytesRead !== metadataLength) {
      throw new Error("Invalid .edenite file: incomplete metadata");
    }
    const metadata = JSON.parse(
      metadataBuffer.toString("utf-8"),
    ) as ArchiveMetadata;
    if (metadata.version !== ARCHIVE_FORMAT_VERSION) {
      throw new Error(
        `Unsupported .edenite archive version: ${String(metadata.version)}`,
      );
    }
    const validation = validatePackageManifestObject(metadata.manifest);
    if (!validation.valid) {
      throw new Error(
        `Invalid archive manifest: ${validation.errors.join("; ")}`,
      );
    }
    return { metadata, payloadOffset: 4 + metadataLength };
  } finally {
    await file.close();
  }
}

export async function calculateFileChecksum(
  filePath: string,
  start: number,
): Promise<string> {
  const hash = crypto.createHash("sha256");
  const stream = createReadStream(filePath, { start });
  return new Promise((resolve, reject) => {
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export async function extractArchivePayload(
  edenitePath: string,
  payloadOffset: number,
  outputDirectory: string,
): Promise<void> {
  const temporaryTar = path.join(
    outputDirectory,
    `.edenite-payload-${process.pid}-${Date.now()}.tar`,
  );
  const zstd = spawn("zstd", ["-dc"], { stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  zstd.stderr.setEncoding("utf-8");
  zstd.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const zstdExit = new Promise<void>((resolve, reject) => {
    zstd.on("error", (error: NodeJS.ErrnoException) => {
      reject(
        error.code === "ENOENT"
          ? new Error(
              "System zstd executable not found. Install zstd to extract .edenite archives.",
            )
          : error,
      );
    });
    zstd.on("close", (code) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            `zstd decompression failed with exit code ${code}: ${stderr.trim()}`,
          ),
        );
      }
    });
  });
  try {
    await Promise.all([
      pipeline(
        createReadStream(edenitePath, { start: payloadOffset }),
        zstd.stdin,
      ),
      pipeline(zstd.stdout, createWriteStream(temporaryTar)),
      zstdExit,
    ]);
    let validationError: Error | undefined;
    await tar.list({
      file: temporaryTar,
      strict: true,
      onentry: (entry) => {
        if (validationError) return;
        try {
          validateArchiveEntry(entry.path, entry.type);
        } catch (error) {
          validationError =
            error instanceof Error ? error : new Error(String(error));
        }
      },
    });
    if (validationError) throw validationError;
    await tar.extract({
      file: temporaryTar,
      cwd: outputDirectory,
      strict: true,
      preservePaths: false,
    });
  } finally {
    await fs.rm(temporaryTar, { force: true });
  }
}

function validateArchiveEntry(entryPath: string, entryType: string): void {
  const normalized = entryPath.replace(/\\/g, "/");
  if (
    path.posix.isAbsolute(normalized) ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized.includes("\0")
  ) {
    throw new Error(`Unsafe archive path: ${entryPath}`);
  }
  if (entryType !== "File" && entryType !== "Directory") {
    throw new Error(
      `Unsupported archive entry type ${entryType}: ${entryPath}`,
    );
  }
}
