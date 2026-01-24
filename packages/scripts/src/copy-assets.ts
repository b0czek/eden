/**
 * Copy SDK Assets
 *
 * Copies SDK runtime assets to the consumer's dist directory.
 * This includes:
 * - app-runtime (preload scripts)
 * - app-frame (frame injector)
 * - edencss (design tokens and utilities)
 * - foundation (foundation layer HTML/JS)
 */

import * as fs from "fs/promises";
import * as path from "path";
import { buildSeedConfig } from "./config";

export interface CopyAssetsOptions {
  sdkPath?: string;
  outputDir?: string;
  configPath?: string;
}

const ASSETS_TO_COPY = ["app-runtime", "app-frame", "edencss", "foundation"];

/**
 * Resolve the SDK dist path
 */
async function resolveSdkDistPath(sdkPath?: string): Promise<string> {
  if (sdkPath) {
    const distPath = path.join(sdkPath, "dist");
    try {
      await fs.access(distPath);
      return distPath;
    } catch {
      throw new Error(
        `SDK dist not found at ${distPath}. Run build:sdk first.`,
      );
    }
  }

  // Try to resolve from node_modules
  try {
    const sdkPackagePath = require.resolve("@edenapp/sdk/package.json");
    const sdkDir = path.dirname(sdkPackagePath);
    const distPath = path.join(sdkDir, "dist");
    try {
      await fs.access(distPath);
      return distPath;
    } catch {
      throw new Error(
        `SDK dist not found at ${distPath}. Is @edenapp/sdk built?`,
      );
    }
  } catch {
    throw new Error(
      "Could not find @edenapp/sdk. Install it or provide --sdk-path.",
    );
  }
}

/**
 * Copy a directory recursively
 */
async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Copy SDK assets to consumer's dist
 */
export async function copyAssets(
  options: CopyAssetsOptions = {},
): Promise<void> {
  const cwd = process.cwd();
  const outputDir = options.outputDir || path.join(cwd, "dist");
  const configPath = options.configPath || path.join(cwd, "eden.config.json");

  console.log("📦 Copying SDK assets to consumer dist...\n");

  // Resolve SDK dist path
  const sdkDistPath = await resolveSdkDistPath(options.sdkPath);
  console.log(`SDK dist: ${sdkDistPath}`);
  console.log(`Output:   ${outputDir}\n`);

  // Ensure output directory exists
  await fs.mkdir(outputDir, { recursive: true });

  // Copy each asset directory
  for (const asset of ASSETS_TO_COPY) {
    const srcPath = path.join(sdkDistPath, asset);
    const destPath = path.join(outputDir, asset);

    try {
      await fs.access(srcPath);
      await copyDir(srcPath, destPath);
      console.log(`✅ Copied ${asset}/`);
    } catch (error) {
      console.warn(`⚠️  ${asset}/ not found in SDK, skipping`);
    }
  }

  console.log("\n🎉 SDK assets copied successfully!");

  // Build seed config (hashed users, default user, settings)
  try {
    await fs.access(configPath);
    const seedConfig = await buildSeedConfig(configPath);
    if (seedConfig) {
      const seedPath = path.join(outputDir, "eden-seed.json");
      await fs.writeFile(
        seedPath,
        JSON.stringify(seedConfig, null, 2),
        "utf-8",
      );
      console.log(`✅ Generated seed config: ${seedPath}`);
    } else {
      console.log("ℹ️  No seed config entries to write");
    }
  } catch {
    console.log("ℹ️  No eden.config.json found for seed config generation");
  }
}
