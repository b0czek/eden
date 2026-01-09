/**
 * Build Apps Script
 *
 * Builds Eden apps from multiple sources:
 * - builtin: Apps bundled with @edenapp/sdk
 * - local: Apps from user's project directory
 * - npm: Apps from npm packages
 */

import * as fs from "fs/promises";
import * as path from "path";
import { GenesisBundler } from "@edenapp/genesis";
import { loadConfig, resolveSdkAppsPath, AppSource } from "./config";

export interface BuildAppsOptions {
  force?: boolean;
  configPath?: string;
  sdkPath?: string;
}

interface BuildCache {
  [appId: string]: {
    lastBuilt: number;
    sourceHash: string;
  };
}

const PREBUILT_DIR = "dist/apps/prebuilt";
const BUILD_CACHE_PATH = ".build-cache.json";

async function loadBuildCache(cwd: string): Promise<BuildCache> {
  try {
    const content = await fs.readFile(
      path.join(cwd, BUILD_CACHE_PATH),
      "utf-8"
    );
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function saveBuildCache(cwd: string, cache: BuildCache): Promise<void> {
  await fs.writeFile(
    path.join(cwd, BUILD_CACHE_PATH),
    JSON.stringify(cache, null, 2)
  );
}

async function getSourceTimestamp(appDir: string): Promise<number> {
  let latestTime = 0;

  try {
    const srcDir = path.join(appDir, "src");
    const files = await fs.readdir(srcDir, { recursive: true });

    for (const file of files) {
      const filePath = path.join(srcDir, file as string);
      try {
        const stats = await fs.stat(filePath);
        if (stats.isFile() && stats.mtimeMs > latestTime) {
          latestTime = stats.mtimeMs;
        }
      } catch {
        // Ignore errors for individual files
      }
    }
  } catch {
    // No src directory, check manifest timestamp
    try {
      const manifestPath = path.join(appDir, "manifest.json");
      const stats = await fs.stat(manifestPath);
      latestTime = stats.mtimeMs;
    } catch {
      latestTime = Date.now();
    }
  }

  return latestTime;
}

async function needsRebuild(
  appId: string,
  appDir: string,
  targetDir: string,
  cache: BuildCache
): Promise<boolean> {
  // Always rebuild if output doesn't exist
  try {
    await fs.access(targetDir);
  } catch {
    return true;
  }

  const cached = cache[appId];
  if (!cached) {
    return true;
  }

  const currentTimestamp = await getSourceTimestamp(appDir);
  return currentTimestamp > cached.lastBuilt;
}

/**
 * Resolve the source directory for an app
 */
async function resolveAppDirectory(
  appSource: AppSource,
  cwd: string,
  sdkAppsPath: string | null
): Promise<string | null> {
  switch (appSource.source) {
    case "builtin": {
      if (!sdkAppsPath) {
        console.error(
          `❌ Cannot find SDK apps directory for builtin app: ${appSource.id}`
        );
        return null;
      }
      // Convert app ID to directory path (e.g., com.eden.files -> com/eden/files)
      const parts = appSource.id.split(".");
      const appPath = path.join(sdkAppsPath, ...parts);
      try {
        await fs.access(appPath);
        return appPath;
      } catch {
        console.error(
          `❌ Builtin app not found: ${appSource.id} (looked in ${appPath})`
        );
        return null;
      }
    }

    case "local": {
      const appPath = path.isAbsolute(appSource.path)
        ? appSource.path
        : path.join(cwd, appSource.path);
      try {
        await fs.access(appPath);
        return appPath;
      } catch {
        console.error(
          `❌ Local app not found: ${appSource.id} (looked in ${appPath})`
        );
        return null;
      }
    }

    case "npm": {
      try {
        // Try to resolve the package
        const packageJsonPath = require.resolve(
          `${appSource.package}/package.json`,
          {
            paths: [cwd],
          }
        );
        const packageDir = path.dirname(packageJsonPath);
        return packageDir;
      } catch {
        console.error(`❌ npm app package not found: ${appSource.package}`);
        return null;
      }
    }

    default: {
      // Exhaustive check - this should never happen
      const _exhaustiveCheck: never = appSource;
      console.error(
        `❌ Unknown app source type for: ${(_exhaustiveCheck as AppSource).id}`
      );
      return null;
    }
  }
}

async function buildApp(
  appSource: AppSource,
  appDir: string,
  targetDir: string,
  cache: BuildCache,
  force: boolean
): Promise<boolean> {
  console.log(`\n📦 Building ${appSource.id}...`);
  console.log(
    `   Source: ${appSource.source}${
      appSource.source === "local" ? ` (${appSource.path})` : ""
    }`
  );

  // Check if rebuild is needed
  if (!force && !(await needsRebuild(appSource.id, appDir, targetDir, cache))) {
    console.log(`  ⏭️  Skipping - no changes since last build`);
    return true;
  }

  // Use Genesis bundler in extractToDirectory mode
  const result = await GenesisBundler.bundle({
    appDirectory: appDir,
    extractToDirectory: targetDir,
    verbose: false,
  });

  if (!result.success) {
    console.error(`❌ Failed to build ${appSource.id}:`);
    console.error(`   ${result.error}`);
    return false;
  }

  // Update cache
  cache[appSource.id] = {
    lastBuilt: Date.now(),
    sourceHash: "",
  };

  console.log(
    `✅ Successfully built ${result.manifest?.name} (${appSource.id})`
  );
  return true;
}

export async function buildApps(options: BuildAppsOptions = {}): Promise<void> {
  const cwd = process.cwd();
  const configPath = options.configPath || "eden.config.json";

  console.log("🚀 Building Eden Apps\n");

  // Load configuration
  const config = await loadConfig(path.join(cwd, configPath));

  if (config.apps.length === 0) {
    console.log("ℹ️  No apps configured in eden.config.json");
    return;
  }

  console.log(`Found ${config.apps.length} app(s) to build:`);
  config.apps.forEach((app) => {
    const sourceInfo =
      app.source === "local"
        ? ` (${app.path})`
        : app.source === "npm"
        ? ` (${app.package})`
        : "";
    console.log(`  - ${app.id} [${app.source}]${sourceInfo}`);
  });

  // Resolve SDK apps path for builtin apps
  const sdkAppsPath = await resolveSdkAppsPath(options.sdkPath);
  if (config.apps.some((app) => app.source === "builtin") && !sdkAppsPath) {
    console.error("\n❌ Cannot find @edenapp/sdk apps directory.");
    console.error(
      "   Make sure @edenapp/sdk is installed or provide --sdk-path"
    );
    process.exit(1);
  }

  // Load build cache
  const cache = await loadBuildCache(cwd);

  // Force rebuild if --force flag is passed
  const force = options.force || false;
  if (force) {
    console.log("\n🔨 Force rebuild requested, rebuilding all apps...");
  }

  // Ensure prebuilt directory exists
  const prebuiltDir = path.join(cwd, PREBUILT_DIR);
  await fs.mkdir(prebuiltDir, { recursive: true });

  // Build each app
  let successCount = 0;
  let failCount = 0;
  let skippedCount = 0;

  for (const appSource of config.apps) {
    const appDir = await resolveAppDirectory(appSource, cwd, sdkAppsPath);
    if (!appDir) {
      failCount++;
      continue;
    }

    const targetDir = path.join(prebuiltDir, appSource.id);

    // Check if rebuild is needed (for skip counting)
    if (
      !force &&
      !(await needsRebuild(appSource.id, appDir, targetDir, cache))
    ) {
      console.log(`\n📦 ${appSource.id}`);
      console.log(`  ⏭️  Skipping - no changes since last build`);
      skippedCount++;
      successCount++;
      continue;
    }

    const success = await buildApp(appSource, appDir, targetDir, cache, force);
    if (success) {
      successCount++;
    } else {
      failCount++;
    }
  }

  // Save updated cache
  await saveBuildCache(cwd, cache);

  // Summary
  console.log("\n" + "=".repeat(50));
  console.log(`✅ Successfully built: ${successCount}`);
  if (skippedCount > 0) {
    console.log(`⏭️  Skipped (unchanged): ${skippedCount}`);
  }
  if (failCount > 0) {
    console.log(`❌ Failed: ${failCount}`);
    process.exit(1);
  }
  console.log("🎉 All apps built successfully!");
}
