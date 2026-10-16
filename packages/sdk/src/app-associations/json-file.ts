import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as Effect from "effect/Effect";
import type { AppAssociationStorage } from "./ports";

export function createJsonFileAssociationStorage(
  userDirectory: string,
): AppAssociationStorage {
  const associationsPath = path.join(userDirectory, "app-associations.json");
  const storageError = (error: unknown): Error =>
    error instanceof Error ? error : new Error(String(error));

  return {
    read: () =>
      Effect.tryPromise({
        try: () => fs.readFile(associationsPath, "utf-8"),
        catch: storageError,
      }),
    write: (content) =>
      Effect.tryPromise({
        try: async () => {
          await fs.mkdir(path.dirname(associationsPath), { recursive: true });
          await fs.writeFile(associationsPath, content);
        },
        catch: storageError,
      }),
  };
}
