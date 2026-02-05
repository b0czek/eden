import { log } from "../logging";
/**
 * Seed Database
 *
 * Centralized seeding mechanism that writes seed configuration directly
 * to the database. This runs once at startup before managers initialize.
 */

import * as fs from "fs/promises";
import * as path from "path";
import Keyv from "keyv";
import KeyvSqlite from "@keyv/sqlite";
import type { EdenSeedConfig, EdenUserConfig } from "@edenapp/types";
import { defaultGrantsForRole } from "../user/UserGrants";

// Key constants matching UserManager and SettingsManager schemas
const USERS_SEED_VERSION_KEY = "_seed:users:version";
const SETTINGS_SEED_VERSION_KEY = "_seed:settings:version";
const USERS_INDEX_KEY = "users:index";
const DEFAULT_USER_KEY = "users:default";

/**
 * Seed the database from eden-seed.json
 *
 * This should be called once during Eden startup, before any managers
 * are initialized. After seeding, managers simply read from the database.
 */
export async function seedDatabase(
  appsDirectory: string,
  seedDirectory: string,
): Promise<void> {
  const seedPath = path.join(seedDirectory, "eden-seed.json");
  let seedConfig: EdenSeedConfig;

  try {
    const content = await fs.readFile(seedPath, "utf-8");
    seedConfig = JSON.parse(content) as EdenSeedConfig;
  } catch {
    log.info("No seed configuration found (eden-seed.json)");
    return;
  }

  // Check seeded status per section so one DB doesn't block the others.
  const usersDb = createKeyv(appsDirectory, "users.db");
  const usersSeeded = Boolean(await usersDb.get(USERS_SEED_VERSION_KEY));

  const settingsSeed = normalizeSeedSettings(seedConfig);
  const hasSettingsSeed = Object.keys(settingsSeed).length > 0;
  let settingsDb: Keyv | null = null;
  let settingsSeeded = false;

  if (hasSettingsSeed) {
    settingsDb = createKeyv(appsDirectory, "settings.db");
    const settingsSeedVersion = await settingsDb.get(SETTINGS_SEED_VERSION_KEY);
    settingsSeeded = Boolean(settingsSeedVersion);
  }

  if (usersSeeded && (!hasSettingsSeed || settingsSeeded)) {
    log.info("All sections already seeded, skipping");
    return;
  }

  log.info("Seeding database...");

  // Seed users
  if (!usersSeeded) {
    if (seedConfig.users && seedConfig.users.length > 0) {
      await seedUsers(usersDb, seedConfig.users);
    }

    // Seed default user
    if (seedConfig.defaultUsername) {
      await usersDb.set(DEFAULT_USER_KEY, seedConfig.defaultUsername);
      log.info(`Seeded default user: ${seedConfig.defaultUsername}`);
    }

    // Mark users as seeded
    await usersDb.set(USERS_SEED_VERSION_KEY, "1");
  } else {
    log.info("Users already seeded, skipping");
  }

  // Seed settings entries (into settings.db)
  if (hasSettingsSeed && settingsDb) {
    if (settingsSeeded) {
      log.info("Settings already seeded, skipping");
    } else {
      await seedSettings(settingsDb, settingsSeed);
      await settingsDb.set(SETTINGS_SEED_VERSION_KEY, "1");
    }
  }
  log.info("Seeding complete");
}

function createKeyv(appsDirectory: string, dbName: string): Keyv {
  const dbPath = path.join(appsDirectory, dbName);
  const sqlite = new KeyvSqlite(`sqlite://${dbPath}`);
  return new Keyv({ store: sqlite });
}

function getUserKey(username: string): string {
  return `user:${username}`;
}

async function seedUsers(db: Keyv, users: EdenUserConfig[]): Promise<void> {
  const usernames: string[] = [];

  for (const user of users) {
    const existingUser = await db.get(getUserKey(user.username));
    if (existingUser) {
      log.info(`User "${user.username}" already exists, skipping`);
      continue;
    }

    const now = Date.now();
    const storedUser = {
      username: user.username,
      name: user.name,
      role: user.role ?? "standard",
      grants: user.grants ?? defaultGrantsForRole(user.role ?? "standard"),
      createdAt: now,
      updatedAt: now,
      passwordHash: user.passwordHash,
      passwordSalt: user.passwordSalt,
    };

    await db.set(getUserKey(user.username), storedUser);
    usernames.push(user.username);
    log.info(`Seeded user: ${user.name} (${user.username})`);
  }

  // Update user index
  const existingIndex = await db.get(USERS_INDEX_KEY);
  const currentIds = Array.isArray(existingIndex) ? existingIndex : [];
  const mergedUsernames = [...new Set([...currentIds, ...usernames])];
  await db.set(USERS_INDEX_KEY, mergedUsernames);
}

function normalizeSeedSettings(
  seedConfig: EdenSeedConfig,
): Record<string, Record<string, string>> {
  const settings: Record<string, Record<string, string>> = {};

  if (seedConfig.settings && typeof seedConfig.settings === "object") {
    for (const [appId, appSettings] of Object.entries(seedConfig.settings)) {
      if (!appId || !appSettings || typeof appSettings !== "object") continue;
      const entries = Object.entries(appSettings).filter(
        ([key, value]) => key && value !== undefined && value !== null,
      );
      if (entries.length === 0) continue;
      if (!settings[appId]) {
        settings[appId] = {};
      }
      for (const [key, value] of entries) {
        settings[appId][key] = String(value);
      }
    }
  }

  return settings;
}

async function seedSettings(
  db: Keyv,
  settings: Record<string, Record<string, string>>,
): Promise<void> {
  for (const [appId, appSettings] of Object.entries(settings)) {
    for (const [key, value] of Object.entries(appSettings)) {
      const namespacedKey = `${appId}:${key}`;
      const existing = await db.get(namespacedKey);
      if (existing !== undefined) {
        log.info(`Setting "${appId}:${key}" already exists, skipping`);
        continue;
      }

      await db.set(namespacedKey, value);
      log.info(`Seeded setting: ${appId}:${key}`);
    }
  }
}
