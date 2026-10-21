import { io } from "../filesystem/native-io";
import { log } from "../logging/logger";

/**
 * Seed Database
 *
 * Centralized seeding mechanism that writes seed configuration directly
 * to the database. This runs once at startup before services initialize.
 */

import * as path from "node:path";
import type { EdenSeedConfig, EdenUserConfig } from "@edenapp/types";
import * as Effect from "effect/Effect";
import { openKeyvSqlite } from "../storage/keyv-sqlite";
import { ensureDirectoryRestriction } from "../user/directory-restriction";
import { defaultGrantsForRole } from "../user/grants";

// Key constants matching user and settings storage schemas
const USERS_SEED_VERSION_KEY = "_seed:users:version";
const SETTINGS_SEED_VERSION_KEY = "_seed:settings:version";
const USERS_INDEX_KEY = "users:index";
const DEFAULT_USER_KEY = "users:default";

/**
 * Seed the database from a seed config file (eden-seed.json)
 *
 * This should be called once during Eden startup, before any services
 * are initialized. After seeding, services simply read from the database.
 */
export const seedDatabase = Effect.fn(function* (
  appsDirectory: string,
  seedPath: string,
  userDirectory: string,
) {
  const seedConfig = yield* io.readFile(seedPath, "utf-8").pipe(
    Effect.flatMap((content) =>
      Effect.try(() => JSON.parse(content) as EdenSeedConfig),
    ),
    Effect.catch(() => Effect.succeed(undefined)),
  );
  if (!seedConfig) {
    log.info(`No seed configuration found at ${seedPath}`);
    return;
  }
  const usersDb = yield* openKeyvSqlite({
    dbPath: path.join(appsDirectory, "users.db"),
    label: "user seed storage",
    closedMessage: "User seed storage closed",
  });
  const usersSeeded = Boolean(yield* usersDb.read(USERS_SEED_VERSION_KEY));
  const settingsSeed = normalizeSeedSettings(seedConfig);
  const settingsDb =
    Object.keys(settingsSeed).length > 0
      ? yield* openKeyvSqlite({
          dbPath: path.join(appsDirectory, "settings.db"),
          label: "settings seed storage",
          closedMessage: "Settings seed storage closed",
        })
      : undefined;
  const settingsSeeded = settingsDb
    ? Boolean(yield* settingsDb.read(SETTINGS_SEED_VERSION_KEY))
    : false;
  if (usersSeeded && (!settingsDb || settingsSeeded)) {
    log.info("All sections already seeded, skipping");
    return;
  }
  log.info("Seeding database...");
  if (!usersSeeded) {
    if (seedConfig.users?.length)
      yield* seedUsers(usersDb, seedConfig.users, userDirectory);
    if (seedConfig.defaultUsername) {
      yield* usersDb.write(DEFAULT_USER_KEY, seedConfig.defaultUsername);
      log.info(`Seeded default user: ${seedConfig.defaultUsername}`);
    }
    yield* usersDb.write(USERS_SEED_VERSION_KEY, "1");
  } else log.info("Users already seeded, skipping");
  if (settingsDb) {
    if (settingsSeeded) log.info("Settings already seeded, skipping");
    else {
      yield* seedSettings(settingsDb, settingsSeed);
      yield* settingsDb.write(SETTINGS_SEED_VERSION_KEY, "1");
    }
  }
  log.info("Seeding complete");
}, Effect.scoped);

type SeedConnection = Effect.Success<ReturnType<typeof openKeyvSqlite>>;

function getUserKey(username: string): string {
  return `user:${username}`;
}

const seedUsers = Effect.fn(function* (
  db: SeedConnection,
  users: EdenUserConfig[],
  userDirectory: string,
) {
  const usernames: string[] = [];

  for (const user of users) {
    const existingUser = yield* db.read(getUserKey(user.username));
    if (existingUser) {
      log.info(`User "${user.username}" already exists, skipping`);
      continue;
    }

    const now = Date.now();
    const role = user.role ?? "standard";
    const directoryRestriction = yield* ensureDirectoryRestriction(
      userDirectory,
      role,
      user.directoryRestriction,
    );
    const storedUser = {
      username: user.username,
      name: user.name,
      role,
      directoryRestriction,
      grants: user.grants ?? defaultGrantsForRole(role),
      createdAt: now,
      updatedAt: now,
      passwordHash: user.passwordHash,
      passwordSalt: user.passwordSalt,
    };

    yield* db.write(getUserKey(user.username), storedUser);
    usernames.push(user.username);
    log.info(`Seeded user: ${user.name} (${user.username})`);
  }

  // Update user index
  const existingIndex = yield* db.read(USERS_INDEX_KEY);
  const currentIds = Array.isArray(existingIndex) ? existingIndex : [];
  const mergedUsernames = [...new Set([...currentIds, ...usernames])];
  yield* db.write(USERS_INDEX_KEY, mergedUsernames);
});

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

const seedSettings = Effect.fn(function* (
  db: SeedConnection,
  settings: Record<string, Record<string, string>>,
) {
  for (const [appId, appSettings] of Object.entries(settings)) {
    for (const [key, value] of Object.entries(appSettings)) {
      const namespacedKey = `${appId}:${key}`;
      const existing = yield* db.read(namespacedKey);
      if (existing !== undefined) {
        log.info(`Setting "${appId}:${key}" already exists, skipping`);
        continue;
      }

      yield* db.write(namespacedKey, value);
      log.info(`Seeded setting: ${appId}:${key}`);
    }
  }
});
