import * as path from "node:path";
import * as Effect from "effect/Effect";
import { openKeyvSqlite } from "../storage/keyv-sqlite";
import type { SettingsStorage } from "./ports";

// @eden-effect-next-line unresolved-requirements -- Storage.open acquires its connection in the settings service scope.
export function createSqliteSettingsStorage({
  appsDirectory,
}: {
  appsDirectory: string;
}): SettingsStorage {
  return {
    open: Effect.map(
      openKeyvSqlite({
        dbPath: path.join(appsDirectory, "settings.db"),
        label: "settings storage",
        closedMessage: "Settings storage closed",
      }),
      (connection) => ({
        ...connection,
        remove: (key: string) => Effect.asVoid(connection.remove(key)),
      }),
    ),
  };
}
