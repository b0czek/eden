import * as path from "node:path";
import { openKeyvSqlite } from "../storage/keyv-sqlite";
import type { DbStorage } from "./ports";

export function createSqliteDbStorage({
  appsDirectory,
}: {
  appsDirectory: string;
}): DbStorage {
  return {
    open: openKeyvSqlite({
      dbPath: path.join(appsDirectory, "storage.db"),
      label: "storage",
      closedMessage: "Database connection closed",
    }),
  };
}
