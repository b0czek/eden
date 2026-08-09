import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { PackageManifest } from "@edenapp/types";
import {
  calculateFileChecksum,
  extractArchivePayload,
  readArchiveMetadata,
} from "./archive";
import { executeBuild } from "./build";
import { DEFAULT_COMPRESSOR } from "./compression";
import { validateManifest, verifyFiles } from "./manifest";
import { copyPackageFiles } from "./package-files";
import { createArchive } from "./writer";

const compressor = DEFAULT_COMPRESSOR;
let initialized = false;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export interface BundleOptions {
  appDirectory: string;
  outputPath?: string;
  extractToDirectory?: string;
  verbose?: boolean;
  dryRun?: boolean;
  compressionLevel?: number;
}

export interface BundleResult {
  success: boolean;
  outputPath?: string;
  manifest?: PackageManifest;
  error?: string;
  checksum?: string;
  size?: number;
}

export interface ExtractOptions {
  edenitePath: string;
  outputDirectory: string;
  verbose?: boolean;
  verifyChecksum?: boolean;
}

async function initCompressor(): Promise<void> {
  if (initialized) return;
  await compressor.initialize();
  initialized = true;
}

export async function bundle(options: BundleOptions): Promise<BundleResult> {
  const {
    appDirectory,
    outputPath,
    extractToDirectory,
    verbose,
    dryRun = false,
    compressionLevel = 11,
  } = options;
  try {
    await initCompressor();
    if (verbose) console.log(`📦 Bundling package from: ${appDirectory}`);
    await fs.access(appDirectory);
    const validation = await validateManifest(
      path.join(appDirectory, "manifest.json"),
    );
    if (!validation.valid || !validation.manifest) {
      return {
        success: false,
        error: `Invalid manifest:\n${validation.errors.join("\n")}`,
      };
    }
    const manifest = validation.manifest;
    if (verbose) {
      console.log(
        `✓ Manifest valid: ${String(manifest.name)} v${manifest.version}`,
      );
    }
    if (dryRun) return { success: true, manifest };

    if (manifest.kind !== "dlc") {
      const buildResult = await executeBuild(appDirectory, manifest, verbose);
      if (!buildResult.success) return buildResult;
    }
    const fileCheck = await verifyFiles(appDirectory, manifest);
    if (!fileCheck.valid) {
      return {
        success: false,
        error: `Missing files:\n${fileCheck.errors.join("\n")}`,
      };
    }
    if (extractToDirectory) {
      await copyPackageFiles(
        appDirectory,
        extractToDirectory,
        manifest,
        verbose,
      );
      return {
        success: true,
        outputPath: path.resolve(extractToDirectory),
        manifest,
      };
    }
    const result = await createArchive({
      packageDirectory: appDirectory,
      manifest,
      outputPath,
      verbose,
      compressionLevel,
      compressor,
    });
    return {
      success: true,
      outputPath: result.path,
      manifest,
      checksum: result.checksum,
      size: result.size,
    };
  } catch (error) {
    return { success: false, error: `Bundle failed: ${errorMessage(error)}` };
  }
}

export async function getInfo(edenitePath: string): Promise<{
  success: boolean;
  manifest?: PackageManifest;
  error?: string;
  checksum?: string;
}> {
  try {
    const { metadata } = await readArchiveMetadata(edenitePath);
    return {
      success: true,
      manifest: metadata.manifest,
      checksum: metadata.checksum,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to read archive: ${errorMessage(error)}`,
    };
  }
}

export async function extract(options: ExtractOptions): Promise<{
  success: boolean;
  error?: string;
  manifest?: PackageManifest;
}> {
  const {
    edenitePath,
    outputDirectory,
    verbose,
    verifyChecksum = true,
  } = options;
  try {
    const { metadata, payloadOffset } = await readArchiveMetadata(edenitePath);
    if (verifyChecksum) {
      const checksum = await calculateFileChecksum(edenitePath, payloadOffset);
      if (checksum !== metadata.checksum) {
        throw new Error(
          `Checksum mismatch: expected ${metadata.checksum}, received ${checksum}`,
        );
      }
    }
    await fs.mkdir(outputDirectory, { recursive: true });
    await extractArchivePayload(edenitePath, payloadOffset, outputDirectory);
    const extracted = await validateManifest(
      path.join(outputDirectory, "manifest.json"),
    );
    if (!extracted.valid || !extracted.manifest) {
      throw new Error(
        `Extracted manifest is invalid: ${extracted.errors.join("; ")}`,
      );
    }
    if (!isDeepStrictEqual(extracted.manifest, metadata.manifest)) {
      throw new Error(
        "Extracted manifest does not match the archive metadata manifest",
      );
    }
    if (verbose) console.log(`✓ Extracted to: ${outputDirectory}`);
    return { success: true, manifest: metadata.manifest };
  } catch (error) {
    return {
      success: false,
      error: `Extraction failed: ${errorMessage(error)}`,
    };
  }
}

export { executeBuild } from "./build";
export {
  isDlcCompatible,
  validateAppManifest,
  validateAppManifestObject,
  validateDlcManifestObject,
  validateManifest,
  validateManifestObject,
  validatePackageManifestObject,
  verifyFiles,
} from "./manifest";
