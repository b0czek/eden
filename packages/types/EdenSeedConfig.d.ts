import type { EdenUserConfig } from "./User";

export interface EdenSeedSettings {
  /** Map of appId to settings key/value pairs */
  [appId: string]: Record<string, string>;
}

/**
 * Seed data for one-time initialization
 *
 * Contains data that is seeded into the database on first run.
 * This is separate from runtime config because the data becomes
 * mutable after seeding.
 */
export interface EdenSeedConfig {
  /** Users to seed on first run */
  users?: EdenUserConfig[];

  /** Default username to seed */
  defaultUsername?: string;

  /** Settings to seed (namespaced by appId) */
  settings?: EdenSeedSettings;
}
