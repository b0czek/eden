import type { RuntimeAppManifest } from "@edenapp/types";
import type * as Effect from "effect/Effect";

export interface AppAssociationCatalog {
  getLaunchableApp(appId: string): RuntimeAppManifest | undefined;
  listApps(options: { showHidden: boolean }): RuntimeAppManifest[];
}

export interface AppAssociationStorage {
  read(): Effect.Effect<string, Error>;
  write(content: string): Effect.Effect<void, Error>;
}
