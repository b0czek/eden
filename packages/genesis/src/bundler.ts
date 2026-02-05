import { exec } from "node:child_process";
import * as crypto from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import type { AppManifest } from "@edenapp/types";
import cliProgress from "cli-progress";
import * as tar from "tar";
import { type Compressor, DEFAULT_COMPRESSOR } from "./compression";

const execAsync = promisify(exec);

// Archive format version for forward compatibility
const ARCHIVE_FORMAT_VERSION = 1;

const compressor: Compressor = DEFAULT_COMPRESSOR;
let isInitialized = false;

export interface BundleOptions {
  appDirectory: string;
  outputPath?: string;
  extractToDirectory?: string; // If provided, copy files directly instead of archiving
  verbose?: boolean;
  dryRun?: boolean; // Validate without creating files
  compressionLevel?: number; // Zstd compression level (1-22, default 11)
}

export interface BundleResult {
  success: boolean;
  outputPath?: string;
  manifest?: AppManifest;
  error?: string;
  checksum?: string; // SHA256 checksum of the archive
  size?: number; // Size in bytes
}

export interface ExtractOptions {
  edenitePath: string;
  outputDirectory: string;
  verbose?: boolean;
  verifyChecksum?: boolean;
}

interface ArchiveMetadata {
  version: number;
  checksum: string;
  created: string;
  manifest: AppManifest;
}

async function initCompressor(): Promise<void> {
  if (isInitialized) return;
  await compressor.initialize();
  isInitialized = true;
}

function isRemoteEntry(entry?: string): boolean {
  return !!entry && /^https?:\/\//i.test(entry);
}

function calculateChecksum(data: Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export async function executeBuild(
  appDirectory: string,
  manifest: AppManifest,
  verbose?: boolean,
): Promise<{ success: boolean; error?: string }> {
  if (!manifest.build?.command) {
    return { success: true }; // No build command defined, skip
  }

  try {
    const buildCwd = manifest.build.cwd
      ? path.join(appDirectory, manifest.build.cwd)
      : appDirectory;

    if (verbose) {
      console.log(`🔨 Running build command: ${manifest.build.command}`);
      console.log(`   Working directory: ${buildCwd}`);
    }

    const { stdout, stderr } = await execAsync(manifest.build.command, {
      cwd: buildCwd,
      env: { ...process.env },
    });

    if (verbose && stdout) {
      console.log(`   ${stdout.trim()}`);
    }

    if (stderr && verbose) {
      console.log(`   ${stderr.trim()}`);
    }

    if (verbose) {
      console.log("✓ Build completed successfully");
    }

    return { success: true };
  } catch (error: any) {
    return {
      success: false,
      error: `Build failed: ${error.message}`,
    };
  }
}

export async function validateManifest(
  manifestPath: string,
): Promise<{ valid: boolean; errors: string[]; manifest?: AppManifest }> {
  const errors: string[] = [];

  try {
    const content = await fs.readFile(manifestPath, "utf-8");
    const manifest: AppManifest = JSON.parse(content);

    // Required fields
    if (!manifest.id) errors.push("Missing required field: id");
    if (!manifest.name) errors.push("Missing required field: name");
    if (!manifest.version) errors.push("Missing required field: version");

    // Validate ID format
    if (manifest.id && !/^[a-z0-9.-]+$/.test(manifest.id)) {
      errors.push(
        "Invalid ID format. Use lowercase letters, numbers, dots, and hyphens only.",
      );
    }

    // Backend validation (optional, but ensure entry if provided)
    if (manifest.backend && !manifest.backend.entry) {
      errors.push("Missing required field: backend.entry");
    }

    // Frontend validation (optional, but entry required if frontend exists)
    if (manifest.frontend && !manifest.frontend.entry) {
      errors.push("Missing required field: frontend.entry");
    } else if (
      manifest.frontend &&
      !isRemoteEntry(manifest.frontend.entry) &&
      manifest.frontend.entry.startsWith("http")
    ) {
      errors.push("Invalid frontend.entry URL");
    }

    // Must have at least frontend or backend
    if (!manifest.frontend && !manifest.backend) {
      errors.push("App must have at least a frontend or backend entry");
    }

    return {
      valid: errors.length === 0,
      errors,
      manifest: errors.length === 0 ? manifest : undefined,
    };
  } catch (error: any) {
    errors.push(`Failed to read/parse manifest: ${error.message}`);
    return { valid: false, errors };
  }
}

export async function verifyFiles(
  appDirectory: string,
  manifest: AppManifest,
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  // Check backend entry if defined
  if (manifest.backend?.entry) {
    const backendPath = path.join(appDirectory, manifest.backend.entry);
    try {
      await fs.access(backendPath);
    } catch {
      errors.push(`Backend entry file not found: ${manifest.backend.entry}`);
    }
  }

  // Check frontend entry if defined and not a remote URL
  if (manifest.frontend?.entry && !isRemoteEntry(manifest.frontend.entry)) {
    const frontendPath = path.join(appDirectory, manifest.frontend.entry);
    try {
      await fs.access(frontendPath);
    } catch {
      errors.push(`Frontend entry file not found: ${manifest.frontend.entry}`);
    }
  }

  // Check icon if specified (warn but don't fail)
  if (manifest.icon) {
    const iconPath = path.join(appDirectory, manifest.icon);
    try {
      await fs.access(iconPath);
    } catch {
      // Icon is optional, so just warn in verbose mode
      // Don't add to errors array
    }
  }

  return { valid: errors.length === 0, errors };
}

function shouldExcludeFile(filePath: string, manifest?: AppManifest): boolean {
  // Check if this path is explicitly included via manifest
  if (manifest?.include) {
    for (const includePath of manifest.include) {
      // Normalize paths for comparison
      const normalizedInclude = includePath.replace(/\\/g, "/");
      const normalizedFile = filePath.replace(/\\/g, "/");

      // Check if the file path starts with or equals the include path
      if (
        normalizedFile === normalizedInclude ||
        normalizedFile.startsWith(`${normalizedInclude}/`)
      ) {
        return false; // Don't exclude - explicitly included
      }
    }
  }

  const excludePatterns = [
    // Dependencies
    /^node_modules\//,
    /^node_modules$/,
    // Source files (we only want the built output)
    /^src\//,
    /^src$/,
    // Config files
    /^tsconfig\.json$/,
    /^tsconfig\..+\.json$/,
    /^vite\.config\..+$/,
    /^\.eslintrc/,
    /^\.prettierrc/,
    /^\.gitignore$/,
    /^\.git\//,
    /^\.DS_Store$/,
    // Lock files
    /^package-lock\.json$/,
    /^pnpm-lock\.yaml$/,
    /^yarn\.lock$/,
    // Build artifacts that shouldn't be included
    /^\.vite\//,
    /^\.cache\//,
    // Test files
    /^__tests__\//,
    /\.test\.[jt]sx?$/,
    /\.spec\.[jt]sx?$/,
  ];

  return excludePatterns.some((pattern) => pattern.test(filePath));
}

async function extractToDirectory(
  appDirectory: string,
  targetDir: string,
  manifest?: AppManifest,
  verbose?: boolean,
): Promise<void> {
  const resolvedTarget = path.resolve(targetDir);

  if (verbose) console.log(`📁 Copying files to: ${resolvedTarget}`);

  // Ensure target directory exists
  await fs.mkdir(resolvedTarget, { recursive: true });

  // Copy all files from the app directory (excluding development files)
  const files = await fs.readdir(appDirectory, { recursive: true });

  let copiedCount = 0;
  let skippedCount = 0;

  for (const file of files) {
    const fileStr = file as string;

    // Skip excluded files
    if (shouldExcludeFile(fileStr, manifest)) {
      skippedCount++;
      continue;
    }

    const sourcePath = path.join(appDirectory, fileStr);
    const stat = await fs.stat(sourcePath);

    if (stat.isFile()) {
      const targetPath = path.join(resolvedTarget, fileStr);
      const targetFileDir = path.dirname(targetPath);

      // Ensure subdirectory exists
      await fs.mkdir(targetFileDir, { recursive: true });

      // Copy file
      await fs.copyFile(sourcePath, targetPath);
      copiedCount++;

      if (verbose) console.log(`  + ${fileStr}`);
    }
  }

  if (verbose) {
    console.log(`✓ Files copied to: ${resolvedTarget}`);
    console.log(
      `  Copied: ${copiedCount} files, Skipped: ${skippedCount} (dev files)`,
    );
  }
}

async function createArchive(
  appDirectory: string,
  manifest: AppManifest,
  outputPath?: string,
  verbose?: boolean,
  compressionLevel: number = 11,
): Promise<{ path: string; checksum: string; size: number }> {
  await initCompressor();

  const finalOutputPath =
    outputPath ||
    path.join(process.cwd(), `${manifest.id}-${manifest.version}.edenite`);

  // Create temporary tar file
  const tempTarPath = `${finalOutputPath}.tmp.tar`;

  if (verbose) console.log("📦 Creating TAR archive...");

  let progressBar: cliProgress.SingleBar | null = null;

  // Get file list for progress tracking (excluding development files)
  const allFiles = await fs.readdir(appDirectory, { recursive: true });
  const fileList = [];

  for (const file of allFiles) {
    const fileStr = file as string;
    // Skip excluded files
    if (shouldExcludeFile(fileStr, manifest)) {
      continue;
    }
    const filePath = path.join(appDirectory, fileStr);
    const stat = await fs.stat(filePath);
    if (stat.isFile()) {
      fileList.push(fileStr);
    }
  }

  if (verbose && fileList.length > 50) {
    progressBar = new cliProgress.SingleBar({
      format: "  Progress |{bar}| {percentage}% | {value}/{total} files",
      barCompleteChar: "\u2588",
      barIncompleteChar: "\u2591",
      hideCursor: true,
    });
    progressBar.start(fileList.length, 0);
  }

  let processedFiles = 0;

  // Create TAR archive
  await tar.create(
    {
      file: tempTarPath,
      cwd: appDirectory,
      gzip: false,
      portable: true,
      filter: (entryPath, stat) => {
        if (verbose && progressBar) {
          processedFiles++;
          progressBar.update(processedFiles);
        } else if (verbose) {
          console.log(`  + ${entryPath}`);
        }
        return true;
      },
    },
    fileList,
  );

  if (progressBar) {
    progressBar.stop();
  }

  if (verbose) console.log("🗜️  Compressing with Zstandard...");

  // Create temporary file for compressed output
  const tempCompressedPath = `${tempTarPath}.zst`;

  // Compress with configured compressor using streaming to disk
  const { checksum } = await compressor.compressFileStreaming(
    tempTarPath,
    tempCompressedPath,
    compressionLevel,
  );

  // Create metadata
  const metadata: ArchiveMetadata = {
    version: ARCHIVE_FORMAT_VERSION,
    checksum,
    created: new Date().toISOString(),
    manifest,
  };

  // Combine metadata + compressed data
  // Format: [4 bytes metadata length][metadata JSON][compressed stream]
  const metadataJson = JSON.stringify(metadata);
  const metadataBuffer = Buffer.from(metadataJson, "utf-8");
  const metadataLength = Buffer.alloc(4);
  metadataLength.writeUInt32BE(metadataBuffer.length, 0);

  const finalWriteStream = createWriteStream(finalOutputPath);

  // Write metadata length and buffer
  finalWriteStream.write(metadataLength);
  finalWriteStream.write(metadataBuffer);

  // Stream compressed content to final file
  const compressedReadStream = createReadStream(tempCompressedPath);

  await new Promise<void>((resolve, reject) => {
    compressedReadStream.pipe(finalWriteStream);
    compressedReadStream.on("error", reject);
    finalWriteStream.on("error", reject);
    finalWriteStream.on("finish", resolve);
  });

  // Get stats for logging
  const tarStats = await fs.stat(tempTarPath);
  const finalStats = await fs.stat(finalOutputPath);

  // Clean up temp files
  await fs.unlink(tempTarPath);
  await fs.unlink(tempCompressedPath);

  if (verbose) {
    const originalSize = tarStats.size;
    const finalSize = finalStats.size;
    const metadataSize = metadataLength.length + metadataBuffer.length;
    const compressedSize = finalSize - metadataSize; // Approximate

    console.log(`✓ Archive created: ${finalOutputPath}`);
    console.log(`  Original size: ${(originalSize / 1024).toFixed(2)} KB`);
    console.log(`  Compressed size: ${(compressedSize / 1024).toFixed(2)} KB`);
    console.log(
      `  Compression ratio: ${((1 - compressedSize / originalSize) * 100).toFixed(1)}%`,
    );
    console.log(`  SHA256: ${checksum}`);
  }

  return {
    path: finalOutputPath,
    checksum,
    size: finalStats.size,
  };
}

export async function bundle(options: BundleOptions): Promise<BundleResult> {
  const {
    appDirectory,
    outputPath,
    extractToDirectory: extractTarget,
    verbose,
    dryRun = false,
    compressionLevel = 11,
  } = options;

  try {
    // Initialize compressor
    await initCompressor();

    if (verbose) console.log(`📦 Bundling app from: ${appDirectory}`);

    // Check if directory exists
    try {
      await fs.access(appDirectory);
    } catch {
      return {
        success: false,
        error: `App directory not found: ${appDirectory}`,
      };
    }

    // Read and validate manifest
    const manifestPath = path.join(appDirectory, "manifest.json");
    const validation = await validateManifest(manifestPath);

    if (!validation.valid) {
      return {
        success: false,
        error: `Invalid manifest:\n${validation.errors.join("\n")}`,
      };
    }

    const manifest = validation.manifest!;

    if (verbose) {
      console.log(`✓ Manifest valid: ${manifest.name} v${manifest.version}`);
    }

    // If dry run, stop here
    if (dryRun) {
      if (verbose) console.log("✓ Dry run successful - no files created");
      return {
        success: true,
        manifest,
      };
    }

    // Execute build command if defined (before verifying files, as build may create them)
    const buildResult = await executeBuild(appDirectory, manifest, verbose);
    if (!buildResult.success) {
      return {
        success: false,
        error: buildResult.error,
      };
    }

    // Verify required files exist (after build)
    const fileCheck = await verifyFiles(appDirectory, manifest);
    if (!fileCheck.valid) {
      return {
        success: false,
        error: `Missing files:\n${fileCheck.errors.join("\n")}`,
      };
    }

    if (verbose) console.log("✓ All required files present");

    // If extractToDirectory is provided, copy files directly
    if (extractTarget) {
      await extractToDirectory(appDirectory, extractTarget, manifest, verbose);

      return {
        success: true,
        outputPath: path.resolve(extractTarget),
        manifest,
      };
    }

    // Otherwise, create compressed archive
    const result = await createArchive(
      appDirectory,
      manifest,
      outputPath,
      verbose,
      compressionLevel,
    );

    return {
      success: true,
      outputPath: result.path,
      manifest,
      checksum: result.checksum,
      size: result.size,
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Bundle failed: ${error.message}`,
    };
  }
}

export async function getInfo(edenitePath: string): Promise<{
  success: boolean;
  manifest?: AppManifest;
  error?: string;
  checksum?: string;
}> {
  try {
    await initCompressor();

    // Read the .edenite file
    const data = await fs.readFile(edenitePath);

    // Read metadata length (first 4 bytes)
    const metadataLength = data.readUInt32BE(0);

    // Read metadata
    const metadataBuffer = data.subarray(4, 4 + metadataLength);
    const metadata: ArchiveMetadata = JSON.parse(
      metadataBuffer.toString("utf-8"),
    );

    return {
      success: true,
      manifest: metadata.manifest,
      checksum: metadata.checksum,
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to read archive: ${error.message}`,
    };
  }
}

export async function extract(options: ExtractOptions): Promise<{
  success: boolean;
  error?: string;
  manifest?: AppManifest;
}> {
  const {
    edenitePath,
    outputDirectory,
    verbose,
    verifyChecksum = true,
  } = options;

  try {
    await initCompressor();

    if (verbose) console.log(`📂 Extracting: ${edenitePath}`);

    // Read the .edenite file
    const data = await fs.readFile(edenitePath);

    // Read metadata length (first 4 bytes)
    const metadataLength = data.readUInt32BE(0);

    // Read metadata
    const metadataBuffer = data.subarray(4, 4 + metadataLength);
    const metadata: ArchiveMetadata = JSON.parse(
      metadataBuffer.toString("utf-8"),
    );

    if (verbose) {
      console.log(`✓ Archive format version: ${metadata.version}`);
      console.log(`✓ Created: ${metadata.created}`);
    }

    // Read compressed data
    const compressedData = data.subarray(4 + metadataLength);

    // Verify checksum if requested
    if (verifyChecksum) {
      const actualChecksum = calculateChecksum(Buffer.from(compressedData));
      if (actualChecksum !== metadata.checksum) {
        return {
          success: false,
          error: `Checksum mismatch! Archive may be corrupted.\nExpected: ${metadata.checksum}\nActual: ${actualChecksum}`,
        };
      }
      if (verbose) console.log("✓ Checksum verified");
    }

    if (verbose) console.log("🗜️  Decompressing...");

    // Decompress with configured compressor
    const decompressedBuffer = await compressor.decompress(
      Buffer.from(compressedData),
    );

    // Write to temporary tar file
    const tempTarPath = path.join(outputDirectory, `temp-${Date.now()}.tar`);
    await fs.mkdir(outputDirectory, { recursive: true });
    await fs.writeFile(tempTarPath, decompressedBuffer);

    if (verbose) console.log("📦 Extracting TAR archive...");

    // Extract TAR
    await tar.extract({
      file: tempTarPath,
      cwd: outputDirectory,
    });

    // Clean up temp tar file
    await fs.unlink(tempTarPath);

    if (verbose) {
      console.log(`✓ Extracted to: ${outputDirectory}`);
    }

    return {
      success: true,
      manifest: metadata.manifest,
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Extraction failed: ${error.message}`,
    };
  }
}
