/**
 * Build Apps Script
 * 
 * Builds Eden apps specified in eden.config.json and copies them to dist/apps/prebuilt
 * 
 * Uses @edenapp/genesis bundler in extractToDirectory mode for:
 * - Built-in manifest validation
 * - Automatic build command execution  
 * - File verification
 * 
 * Supports incremental builds - skips rebuilding apps that haven't changed
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { GenesisBundler } from '@edenapp/genesis';

interface EdenConfig {
  prebuiltApps: string[];
  hotReload?: {
    enabled: boolean;
    debounce: number;
  };
}

interface BuildCache {
  [appId: string]: {
    lastBuilt: number; // timestamp
    sourceHash: string; // hash of source files
  };
}

const ROOT_DIR = path.join(__dirname, '..');
const APPS_DIR = path.join(ROOT_DIR, 'apps');
const PREBUILT_DIR = path.join(ROOT_DIR, 'dist', 'apps', 'prebuilt');
const BUILD_CACHE_PATH = path.join(ROOT_DIR, '.build-cache.json');

async function loadConfig(): Promise<EdenConfig> {
  const configPath = path.join(ROOT_DIR, 'eden.config.json');
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.warn('⚠️  No eden.config.json found, using defaults');
    return { prebuiltApps: [] };
  }
}

async function loadBuildCache(): Promise<BuildCache> {
  try {
    const content = await fs.readFile(BUILD_CACHE_PATH, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function saveBuildCache(cache: BuildCache): Promise<void> {
  await fs.writeFile(BUILD_CACHE_PATH, JSON.stringify(cache, null, 2));
}

async function getSourceTimestamp(appDir: string): Promise<number> {
  // Get the latest modification time from src directory
  let latestTime = 0;
  
  try {
    const srcDir = path.join(appDir, 'src');
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
      const manifestPath = path.join(appDir, 'manifest.json');
      const stats = await fs.stat(manifestPath);
      latestTime = stats.mtimeMs;
    } catch {
      // Nothing to check, return current time
      latestTime = Date.now();
    }
  }
  
  return latestTime;
}

async function needsRebuild(appId: string, appDir: string, cache: BuildCache): Promise<boolean> {
  // Always rebuild if output doesn't exist (e.g., after clean)
  const targetDir = path.join(PREBUILT_DIR, appId);
  try {
    await fs.access(targetDir);
  } catch {
    return true; // Output doesn't exist, must rebuild
  }
  
  const cached = cache[appId];
  if (!cached) {
    return true; // Never built before
  }
  
  const currentTimestamp = await getSourceTimestamp(appDir);
  
  // Rebuild if source is newer than last build
  return currentTimestamp > cached.lastBuilt;
}

async function findAppDirectory(appId: string): Promise<string | null> {
  // Convert app ID to directory path (e.g., com.eden.files -> com/eden/files)
  const parts = appId.split('.');
  const appPath = path.join(APPS_DIR, ...parts);
  
  try {
    await fs.access(appPath);
    return appPath;
  } catch {
    console.error(`❌ App directory not found: ${appPath}`);
    return null;
  }
}

async function buildPrebuiltApp(appId: string, cache: BuildCache, force: boolean = false): Promise<boolean> {
  console.log(`\n📦 Building ${appId}...`);
  
  // Find app directory
  const appDir = await findAppDirectory(appId);
  if (!appDir) {
    return false;
  }
  
  // Check if rebuild is needed
  if (!force && !(await needsRebuild(appId, appDir, cache))) {
    console.log(`  ⏭️  Skipping - no changes since last build`);
    return true;
  }
  
  // Determine target directory
  const targetDir = path.join(PREBUILT_DIR, appId);
  
  // Use Genesis bundler in extractToDirectory mode
  const result = await GenesisBundler.bundle({
    appDirectory: appDir,
    extractToDirectory: targetDir,
    verbose: false,
  });
  
  if (!result.success) {
    console.error(`❌ Failed to build ${appId}:`);
    console.error(`   ${result.error}`);
    return false;
  }
  
  // Update cache
  cache[appId] = {
    lastBuilt: Date.now(),
    sourceHash: '', // Could use actual hash in future
  };
  
  console.log(`✅ Successfully built ${result.manifest?.name} (${appId})`);
  return true;
}

async function main() {
  console.log('🚀 Building Eden Apps\n');
  
  // Load configuration
  const config = await loadConfig();
  
  if (config.prebuiltApps.length === 0) {
    console.log('ℹ️  No prebuilt apps configured in eden.config.json');
    return;
  }
  
  console.log(`Found ${config.prebuiltApps.length} app(s) to build:`);
  config.prebuiltApps.forEach(app => console.log(`  - ${app}`));
  
  // Load build cache
  const cache = await loadBuildCache();
  
  // Force rebuild if --force flag is passed
  const force = process.argv.includes('--force');
  if (force) {
    console.log('\n🔨 Force rebuild requested, rebuilding all apps...');
  }
  
  // Ensure prebuilt directory exists
  await fs.mkdir(PREBUILT_DIR, { recursive: true });
  
  // Build each app
  let successCount = 0;
  let failCount = 0;
  let skippedCount = 0;
  
  for (const appId of config.prebuiltApps) {
    const appDir = await findAppDirectory(appId);
    if (!appDir) {
      failCount++;
      continue;
    }
    
    // Check if rebuild is needed
    if (!force && !(await needsRebuild(appId, appDir, cache))) {
      console.log(`\n📦 ${appId}`);
      console.log(`  ⏭️  Skipping - no changes since last build`);
      skippedCount++;
      successCount++; // Count as success since it's valid
      continue;
    }
    
    const success = await buildPrebuiltApp(appId, cache, force);
    if (success) {
      successCount++;
    } else {
      failCount++;
    }
  }
  
  // Save updated cache
  await saveBuildCache(cache);
  
  // Summary
  console.log('\n' + '='.repeat(50));
  console.log(`✅ Successfully built: ${successCount}`);
  if (skippedCount > 0) {
    console.log(`⏭️  Skipped (unchanged): ${skippedCount}`);
  }
  if (failCount > 0) {
    console.log(`❌ Failed: ${failCount}`);
    process.exit(1);
  }
  console.log('🎉 All apps built successfully!');
}

main().catch(error => {
  console.error('❌ Build script failed:', error);
  process.exit(1);
});

