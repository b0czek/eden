import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as Effect from "effect/Effect";
import { fromPromise } from "../effects/io";
import type { AppAssociationStorage } from "./ports";

export function createJsonFileAssociationStorage(
  userDirectory: string,
): AppAssociationStorage {
  const associationsPath = path.join(userDirectory, "app-associations.json");
  return {
    read: () => fromPromise(() => fs.readFile(associationsPath, "utf-8")),
    write: Effect.fn(function* (content) {
      yield* fromPromise(() =>
        fs.mkdir(path.dirname(associationsPath), { recursive: true }),
      );
      yield* fromPromise(() => fs.writeFile(associationsPath, content));
    }),
  };
}
