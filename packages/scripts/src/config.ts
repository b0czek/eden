/**
 * Eden Config Types and Loader
 */

import * as fs from "fs/promises";
import * as path from "path";
import { randomBytes, scryptSync } from "crypto";
import type {
  EdenUserConfig,
  EdenSeedConfig,
  EdenSeedSettings,
} from "@edenapp/types";

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
 * Eden project configuration (build-time only)
 *
 * This is used by the build scripts to determine what to include.
 * Seed data (users, settings) is extracted into eden-seed.json.
 */
export interface EdenBuildConfig {
  apps: AppSource[];
  hotReload?: {
    enabled: boolean;
    debounce: number;
  };
  /** Users to seed on first run */
  users?: EdenUserConfig[];
  /** Default username to seed */
  defaultUsername?: string;
  /** Settings to seed (namespaced by appId) */
  settings?: EdenSeedSettings;
}

/**
 * Load Eden build configuration from a file
 */
export async function loadConfig(configPath: string): Promise<EdenBuildConfig> {
  try {
    const content = await fs.readFile(configPath, "utf-8");
    const config = JSON.parse(content);
    return config as EdenBuildConfig;
  } catch (error) {
    console.warn(`⚠️  Could not load ${configPath}, using defaults`);
    return { apps: [] };
  }
}

/**
 * Build seed configuration from build config
 *
 * Extracts seed data (users, settings, defaultUsername) and hashes passwords
 * for users.
 */
export async function buildSeedConfig(
  configPath: string,
): Promise<EdenSeedConfig | null> {
  const config = await loadConfig(configPath);

  const hasUsers = config.users && config.users.length > 0;
  const hasDefaultUser = !!config.defaultUsername;
  const hasSettings = hasSeedSettings(config.settings);

  if (!hasUsers && !hasDefaultUser && !hasSettings) {
    return null;
  }

  const users = config.users?.map((user) => {
    if (user.passwordHash && user.passwordSalt) {
      return {
        username: user.username,
        name: user.name,
        role: user.role,
        passwordHash: user.passwordHash,
        passwordSalt: user.passwordSalt,
        grants: user.grants,
      };
    }

    if (!user.password) {
      throw new Error(`User "${user.username}" is missing password data`);
    }

    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(user.password, salt, 64).toString("hex");

    return {
      username: user.username,
      name: user.name,
      role: user.role,
      passwordHash: hash,
      passwordSalt: salt,
      grants: user.grants,
    };
  });

  return {
    users,
    defaultUsername: config.defaultUsername,
    settings: hasSettings ? config.settings : undefined,
  };
}

function hasSeedSettings(settings?: EdenSeedSettings): boolean {
  if (!settings) return false;
  return Object.values(settings).some(
    (appSettings) => appSettings && Object.keys(appSettings).length > 0,
  );
}

/**
 * Resolve the path to the SDK's prebuilt apps directory
 */
export async function resolveSdkAppsPath(
  sdkPath?: string,
): Promise<string | null> {
  // If explicit path provided, use it
  if (sdkPath) {
    const appsPath = path.join(sdkPath, "dist", "apps", "prebuilt");
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
    const appsPath = path.join(sdkDir, "dist", "apps", "prebuilt");
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
