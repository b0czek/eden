import * as path from "node:path";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { AppsDirectory } from "../../runtime/inputs";
import { openKeyvSqlite } from "../storage/keyv-sqlite";
import { DbStorage } from "./ports";
export const SqliteDbStorageLive = Layer.effect(
  DbStorage,
  Effect.gen(function* () {
    const appsDirectory = yield* AppsDirectory;
    const connection = yield* openKeyvSqlite({
      dbPath: path.join(appsDirectory, "storage.db"),
      label: "storage",
      closedMessage: "Database connection closed",
    });
    return connection;
  }),
);
