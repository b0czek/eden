import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as Effect from "effect/Effect";
import { fromPromise } from "../effects/io";
import {
  AppAssociationStorageReadError,
  AppAssociationStorageWriteError,
} from "./errors";
import type { AppAssociationStorage } from "./ports";

export function createJsonFileAssociationStorage(
  userDirectory: string,
): AppAssociationStorage {
  const associationsPath = path.join(userDirectory, "app-associations.json");
  return {
    read: () =>
      fromPromise(
        () => fs.readFile(associationsPath, "utf-8"),
        (cause) =>
          new AppAssociationStorageReadError({ path: associationsPath, cause }),
      ),
    write: Effect.fn(function* (content) {
      yield* fromPromise(
        () => fs.mkdir(path.dirname(associationsPath), { recursive: true }),
        (cause) =>
          new AppAssociationStorageWriteError({
            path: associationsPath,
            cause,
          }),
      );
      yield* fromPromise(
        () => fs.writeFile(associationsPath, content),
        (cause) =>
          new AppAssociationStorageWriteError({
            path: associationsPath,
            cause,
          }),
      );
    }),
  };
}
