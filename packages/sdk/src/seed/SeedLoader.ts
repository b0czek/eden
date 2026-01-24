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
import type {
  EdenSeedConfig,
  EdenUserConfig,
} from "@edenapp/types";

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
    console.log("[Seed] No seed configuration found (eden-seed.json)");
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
    console.log("[Seed] All sections already seeded, skipping");
    return;
  }

  console.log("[Seed] Seeding database...");

  // Seed users
  if (!usersSeeded) {
    if (seedConfig.users && seedConfig.users.length > 0) {
      await seedUsers(usersDb, seedConfig.users);
    }

    // Seed default user
    if (seedConfig.defaultUserId) {
      await usersDb.set(DEFAULT_USER_KEY, seedConfig.defaultUserId);
      console.log(`[Seed] Seeded default user: ${seedConfig.defaultUserId}`);
    }

    // Mark users as seeded
    await usersDb.set(USERS_SEED_VERSION_KEY, "1");
  } else {
    console.log("[Seed] Users already seeded, skipping");
  }

  // Seed settings entries (into settings.db)
  if (hasSettingsSeed && settingsDb) {
    if (settingsSeeded) {
      console.log("[Seed] Settings already seeded, skipping");
    } else {
      await seedSettings(settingsDb, settingsSeed);
      await settingsDb.set(SETTINGS_SEED_VERSION_KEY, "1");
    }
  }
  console.log("[Seed] Seeding complete");
}

function createKeyv(appsDirectory: string, dbName: string): Keyv {
  const dbPath = path.join(appsDirectory, dbName);
  const sqlite = new KeyvSqlite(`sqlite://${dbPath}`);
  return new Keyv({ store: sqlite });
}

function getUserKey(id: string): string {
  return `user:${id}`;
}

async function seedUsers(db: Keyv, users: EdenUserConfig[]): Promise<void> {
  const userIds: string[] = [];

  for (const user of users) {
    const existingUser = await db.get(getUserKey(user.id));
    if (existingUser) {
      console.log(`[Seed] User "${user.id}" already exists, skipping`);
      continue;
    }

    const now = Date.now();
    const storedUser = {
      id: user.id,
      name: user.name,
      role: user.role ?? "standard",
      grants: user.grants ?? defaultGrantsForRole(user.role ?? "standard"),
      createdAt: now,
      updatedAt: now,
      passwordHash: user.passwordHash,
      passwordSalt: user.passwordSalt,
    };

    await db.set(getUserKey(user.id), storedUser);
    userIds.push(user.id);
    console.log(`[Seed] Seeded user: ${user.name} (${user.id})`);
  }

  // Update user index
  const existingIndex = await db.get(USERS_INDEX_KEY);
  const currentIds = Array.isArray(existingIndex) ? existingIndex : [];
  const mergedIds = [...new Set([...currentIds, ...userIds])];
  await db.set(USERS_INDEX_KEY, mergedIds);
}

function defaultGrantsForRole(role: string): string[] {
  if (role === "vendor") {
    return ["*"];
  }
  return ["apps/launch/*", "settings/*"];
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
        console.log(
          `[Seed] Setting "${appId}:${key}" already exists, skipping`,
        );
        continue;
      }

      await db.set(namespacedKey, value);
      console.log(`[Seed] Seeded setting: ${appId}:${key}`);
    }
  }
}
