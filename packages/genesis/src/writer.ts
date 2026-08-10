import { createReadStream, createWriteStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { PackageManifest } from "@edenapp/types";
import cliProgress from "cli-progress";
import * as tar from "tar";
import { ARCHIVE_FORMAT_VERSION, type ArchiveMetadata } from "./archive";
import type { Compressor } from "./compression";
import { listPackageFiles } from "./package-files";

export async function createArchive(options: {
  packageDirectory: string;
  manifest: PackageManifest;
  outputPath?: string;
  verbose?: boolean;
  compressionLevel: number;
  compressor: Compressor;
}): Promise<{ path: string; checksum: string; size: number }> {
  const { packageDirectory, manifest, verbose, compressionLevel, compressor } =
    options;
  const outputPath =
    options.outputPath ??
    path.join(process.cwd(), `${manifest.id}-${manifest.version}.edenite`);
  const tarPath = `${outputPath}.tmp.tar`;
  const compressedPath = `${tarPath}.zst`;
  const files = await listPackageFiles(packageDirectory, manifest);
  let progress: cliProgress.SingleBar | undefined;
  if (verbose && files.length > 50) {
    progress = new cliProgress.SingleBar({
      format: "  Progress |{bar}| {percentage}% | {value}/{total} files",
      hideCursor: true,
    });
    progress.start(files.length, 0);
  }
  let processed = 0;
  try {
    await tar.create(
      {
        file: tarPath,
        cwd: packageDirectory,
        gzip: false,
        portable: true,
        filter: (entryPath) => {
          progress?.update(++processed);
          if (verbose && !progress) console.log(`  + ${entryPath}`);
          return true;
        },
      },
      files,
    );
    progress?.stop();
    const { checksum } = await compressor.compressFileStreaming(
      tarPath,
      compressedPath,
      compressionLevel,
    );
    const metadata: ArchiveMetadata = {
      version: ARCHIVE_FORMAT_VERSION,
      checksum,
      created: new Date().toISOString(),
      manifest,
    };
    const metadataBuffer = Buffer.from(JSON.stringify(metadata), "utf-8");
    const metadataLength = Buffer.alloc(4);
    metadataLength.writeUInt32BE(metadataBuffer.length, 0);
    const output = createWriteStream(outputPath);
    output.write(metadataLength);
    output.write(metadataBuffer);
    await new Promise<void>((resolve, reject) => {
      createReadStream(compressedPath).pipe(output);
      output.on("error", reject);
      output.on("finish", resolve);
    });
    const stat = await fs.stat(outputPath);
    return { path: outputPath, checksum, size: stat.size };
  } finally {
    progress?.stop();
    await fs.rm(tarPath, { force: true });
    await fs.rm(compressedPath, { force: true });
  }
}
