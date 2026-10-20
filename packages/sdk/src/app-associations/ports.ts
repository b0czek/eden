import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type {
  AppAssociationStorageReadError,
  AppAssociationStorageWriteError,
} from "./errors";

export interface AppAssociationStorage {
  read(): Effect.Effect<string, AppAssociationStorageReadError>;
  write(content: string): Effect.Effect<void, AppAssociationStorageWriteError>;
}
export const AppAssociationStorage = Context.Service<
  "eden/AppAssociationStorage",
  AppAssociationStorage
>("eden/AppAssociationStorage");
