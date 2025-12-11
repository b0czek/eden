import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import { exec } from "child_process";
import { promisify } from "util";
import * as tar from "tar";
import cliProgress from "cli-progress";
import { DEFAULT_COMPRESSOR, type Compressor } from "./compression";
import { AppManifest } from "@edenapp/types";

const execAsync = promisify(exec);

// Archive format version for forward compatibility
const ARCHIVE_FORMAT_VERSION = 1;

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

/**
 * Genesis Bundler
 * Packages Eden apps into .edenite format
 */
export class GenesisBundler {
  private static compressor: Compressor = DEFAULT_COMPRESSOR;
  private static isInitialized = false;

  /**
   * Initialize compression library
   */
  private static async initCompressor(): Promise<void> {
    if (this.isInitialized) return;
    await this.compressor.initialize();
    this.isInitialized = true;
  }

  private static isRemoteEntry(entry?: string): boolean {
    return !!entry && /^https?:\/\//i.test(entry);
  }

  /**
   * Calculate SHA256 checksum of data
   */
  private static calculateChecksum(data: Buffer): string {
    return crypto.createHash("sha256").update(data).digest("hex");
  }

  /**
   * Execute build command if defined in manifest
   */
  static async executeBuild(
    appDirectory: string,
    manifest: AppManifest,
    verbose?: boolean
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

  /**
   * Validate an app manifest
   */
  static async validateManifest(
    manifestPath: string
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
      if (manifest.id && !/^[a-z0-9\.\-]+$/.test(manifest.id)) {
        errors.push(
          "Invalid ID format. Use lowercase letters, numbers, dots, and hyphens only."
        );
      }

      // Backend validation (optional, but ensure entry if provided)
      if (manifest.backend && !manifest.backend.entry) {
        errors.push("Missing required field: backend.entry");
      }

      // Frontend validation
      if (!manifest.frontend) {
        errors.push("Missing required field: frontend");
      } else if (!manifest.frontend.entry) {
        errors.push("Missing required field: frontend.entry");
      } else if (
        !this.isRemoteEntry(manifest.frontend.entry) &&
        manifest.frontend.entry.startsWith("http")
      ) {
        errors.push("Invalid frontend.entry URL");
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

  /**
   * Verify that required files exist
   */
  static async verifyFiles(
    appDirectory: string,
    manifest: AppManifest
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

    // Check frontend entry unless it references a remote URL
    if (!this.isRemoteEntry(manifest.frontend.entry)) {
      const frontendPath = path.join(appDirectory, manifest.frontend.entry);
      try {
        await fs.access(frontendPath);
      } catch {
        errors.push(
          `Frontend entry file not found: ${manifest.frontend.entry}`
        );
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

  /**
   * Check if a file path should be excluded from bundling
   */
  private static shouldExcludeFile(filePath: string): boolean {
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

    return excludePatterns.some(pattern => pattern.test(filePath));
  }

  /**
   * Extract app files directly to a directory (no compression)
   */
  private static async extractToDirectory(
    appDirectory: string,
    targetDir: string,
    verbose?: boolean
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
      if (this.shouldExcludeFile(fileStr)) {
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
      console.log(`  Copied: ${copiedCount} files, Skipped: ${skippedCount} (dev files)`);
    }
  }

  /**
   * Create a TAR archive and compress with Zstandard
   */
  private static async createArchive(
    appDirectory: string,
    manifest: AppManifest,
    outputPath?: string,
    verbose?: boolean,
    compressionLevel: number = 11
  ): Promise<{ path: string; checksum: string; size: number }> {
    await this.initCompressor();

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
      if (this.shouldExcludeFile(fileStr)) {
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
        format: '  Progress |{bar}| {percentage}% | {value}/{total} files',
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
        hideCursor: true
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
        filter: (path, stat) => {
          if (verbose && progressBar) {
            processedFiles++;
            progressBar.update(processedFiles);
          } else if (verbose) {
            console.log(`  + ${path}`);
          }
          return true;
        },
      },
      fileList
    );

    if (progressBar) {
      progressBar.stop();
    }

    if (verbose) console.log("🗜️  Compressing with Zstandard...");

    // Read the tar file
    const tarData = await fs.readFile(tempTarPath);

    // Compress with configured compressor
    const compressedBuffer = await this.compressor.compress(
      tarData,
      compressionLevel
    );

    // Calculate checksum of compressed data
    const checksum = this.calculateChecksum(compressedBuffer);

    // Create metadata
    const metadata: ArchiveMetadata = {
      version: ARCHIVE_FORMAT_VERSION,
      checksum,
      created: new Date().toISOString(),
      manifest,
    };

    // Combine metadata + compressed data
    // Format: [4 bytes metadata length][metadata JSON][compressed tar]
    const metadataJson = JSON.stringify(metadata);
    const metadataBuffer = Buffer.from(metadataJson, "utf-8");
    const metadataLength = Buffer.alloc(4);
    metadataLength.writeUInt32BE(metadataBuffer.length, 0);

    const finalData = Buffer.concat([
      metadataLength,
      metadataBuffer,
      compressedBuffer,
    ]);

    // Write final .edenite file
    await fs.mkdir(path.dirname(finalOutputPath), { recursive: true });
    await fs.writeFile(finalOutputPath, finalData);

    // Clean up temp tar file
    await fs.unlink(tempTarPath);

    if (verbose) {
      console.log(`✓ Archive created: ${finalOutputPath}`);
      console.log(`  Original size: ${(tarData.length / 1024).toFixed(2)} KB`);
      console.log(`  Compressed size: ${(finalData.length / 1024).toFixed(2)} KB`);
      console.log(`  Compression ratio: ${((1 - finalData.length / tarData.length) * 100).toFixed(1)}%`);
      console.log(`  SHA256: ${checksum}`);
    }

    return {
      path: finalOutputPath,
      checksum,
      size: finalData.length,
    };
  }

  /**
   * Bundle an app into .edenite format or extract to directory
   */
  static async bundle(options: BundleOptions): Promise<BundleResult> {
    const {
      appDirectory,
      outputPath,
      extractToDirectory,
      verbose,
      dryRun = false,
      compressionLevel = 11,
    } = options;

    try {
      // Initialize compressor
      await this.initCompressor();
      
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
      const validation = await this.validateManifest(manifestPath);

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
      const buildResult = await this.executeBuild(
        appDirectory,
        manifest,
        verbose
      );
      if (!buildResult.success) {
        return {
          success: false,
          error: buildResult.error,
        };
      }

      // Verify required files exist (after build)
      const fileCheck = await this.verifyFiles(appDirectory, manifest);
      if (!fileCheck.valid) {
        return {
          success: false,
          error: `Missing files:\n${fileCheck.errors.join("\n")}`,
        };
      }

      if (verbose) console.log("✓ All required files present");

      // If extractToDirectory is provided, copy files directly
      if (extractToDirectory) {
        await this.extractToDirectory(
          appDirectory,
          extractToDirectory,
          verbose
        );

        return {
          success: true,
          outputPath: path.resolve(extractToDirectory),
          manifest,
        };
      }

      // Otherwise, create compressed archive
      const result = await this.createArchive(
        appDirectory,
        manifest,
        outputPath,
        verbose,
        compressionLevel
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

  /**
   * Extract info from an .edenite file
   */
  static async getInfo(
    edenitePath: string
  ): Promise<{ success: boolean; manifest?: AppManifest; error?: string; checksum?: string }> {
    try {
      await this.initCompressor();

      // Read the .edenite file
      const data = await fs.readFile(edenitePath);

      // Read metadata length (first 4 bytes)
      const metadataLength = data.readUInt32BE(0);

      // Read metadata
      const metadataBuffer = data.subarray(4, 4 + metadataLength);
      const metadata: ArchiveMetadata = JSON.parse(
        metadataBuffer.toString("utf-8")
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

  /**
   * Extract an .edenite file to a directory
   */
  static async extract(options: ExtractOptions): Promise<{
    success: boolean;
    error?: string;
    manifest?: AppManifest;
  }> {
    const { edenitePath, outputDirectory, verbose, verifyChecksum = true } = options;

    try {
      await this.initCompressor();

      if (verbose) console.log(`📂 Extracting: ${edenitePath}`);

      // Read the .edenite file
      const data = await fs.readFile(edenitePath);

      // Read metadata length (first 4 bytes)
      const metadataLength = data.readUInt32BE(0);

      // Read metadata
      const metadataBuffer = data.subarray(4, 4 + metadataLength);
      const metadata: ArchiveMetadata = JSON.parse(
        metadataBuffer.toString("utf-8")
      );

      if (verbose) {
        console.log(`✓ Archive format version: ${metadata.version}`);
        console.log(`✓ Created: ${metadata.created}`);
      }

      // Read compressed data
      const compressedData = data.subarray(4 + metadataLength);

      // Verify checksum if requested
      if (verifyChecksum) {
        const actualChecksum = this.calculateChecksum(
          Buffer.from(compressedData)
        );
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
      const decompressedBuffer = await this.compressor.decompress(
        Buffer.from(compressedData)
      );

      // Write to temporary tar file
      const tempTarPath = path.join(
        outputDirectory,
        `temp-${Date.now()}.tar`
      );
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
}
