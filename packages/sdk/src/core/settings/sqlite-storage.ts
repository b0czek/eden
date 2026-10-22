import * as path from "node:path";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { openKeyvSqlite } from "../../platform/storage/keyv-sqlite";
import { AppsDirectory } from "../../runtime/inputs";
import { SettingsStorage } from "./ports";
export const SqliteSettingsStorageLive = Layer.effect(
  SettingsStorage,
  Effect.gen(function* () {
    const appsDirectory = yield* AppsDirectory;
    const connection = yield* openKeyvSqlite({
      dbPath: path.join(appsDirectory, "settings.db"),
      label: "settings storage",
      closedMessage: "Settings storage closed",
    });
    return {
      ...connection,
      remove: (key: string) => Effect.asVoid(connection.remove(key)),
    };
  }),
);
