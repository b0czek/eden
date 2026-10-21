import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type { FilesystemIoFailed } from "../filesystem/native-errors";

export interface AppAssociationStorage {
  read(): Effect.Effect<string, FilesystemIoFailed>;
  write(content: string): Effect.Effect<void, FilesystemIoFailed>;
}
export const AppAssociationStorage = Context.Service<
  "eden/AppAssociationStorage",
  AppAssociationStorage
>("eden/AppAssociationStorage");
