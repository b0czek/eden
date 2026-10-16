import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface DbConnection {
  read(key: string): Effect.Effect<unknown, unknown>;
  write(key: string, value: string): Effect.Effect<void, unknown>;
  remove(key: string): Effect.Effect<boolean, unknown>;
  keys(): Effect.Effect<readonly unknown[], unknown>;
}

/** Acquiring a connection gives its lifetime to the caller's scope. */
export interface DbStorage {
  readonly open: Effect.Effect<DbConnection, unknown, Scope.Scope>;
}
