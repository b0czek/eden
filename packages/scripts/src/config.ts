/**
 * Eden Config Types and Loader
 */

import * as fs from "fs/promises";
import * as path from "path";

/**
 * App source from Eden's builtin library
 */
export interface BuiltinAppSource {
  id: string;
  source: "builtin";
}

/**
 * App source from a local directory
 */
export interface LocalAppSource {
  id: string;
  source: "local";
  path: string;
}

/**
 * App source from an npm package
 */
export interface NpmAppSource {
  id: string;
  source: "npm";
  package: string;
}

export type AppSource = BuiltinAppSource | LocalAppSource | NpmAppSource;

/**
 * Eden project configuration
 */
export interface EdenConfig {
  apps: AppSource[];
  hotReload?: {
    enabled: boolean;
    debounce: number;
  };
}

/**
 * Load Eden configuration from a file
 */
export async function loadConfig(configPath: string): Promise<EdenConfig> {
  try {
    const content = await fs.readFile(configPath, "utf-8");
    const config = JSON.parse(content);
    return config as EdenConfig;
  } catch (error) {
    console.warn(`⚠️  Could not load ${configPath}, using defaults`);
    return { apps: [] };
  }
}

/**
 * Resolve the path to the SDK's builtin apps directory
 */
export async function resolveSdkAppsPath(
  sdkPath?: string
): Promise<string | null> {
  // If explicit path provided, use it
  if (sdkPath) {
    const appsPath = path.join(sdkPath, "apps");
    try {
      await fs.access(appsPath);
      return appsPath;
    } catch {
      return null;
    }
  }

  // Try to resolve from node_modules
  try {
    const sdkPackagePath = require.resolve("@edenapp/sdk/package.json");
    const sdkDir = path.dirname(sdkPackagePath);
    const appsPath = path.join(sdkDir, "apps");
    try {
      await fs.access(appsPath);
      return appsPath;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}
