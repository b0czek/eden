import type { RuntimeAppManifest, UserProfile } from "@edenapp/types";
import type * as Effect from "effect/Effect";
import type { Event } from "../events/event";
import type { Settings } from "../settings/service";

export interface AutostartSessions {
  currentUser(): UserProfile | null;
  changed: Pick<
    Event<{ currentUser: UserProfile | null; previousUsername: string | null }>,
    "on"
  >;
}

export interface AutostartProcesses {
  isRunning(appId: string): boolean;
  installedManifest(appId: string): RuntimeAppManifest | undefined;
  launch(appId: string, user?: UserProfile): Effect.Effect<void, Error>;
}

export interface DevelopmentAutostart {
  readonly apps: Effect.Effect<
    readonly { id: string; launchOnStart: boolean }[],
    Error
  >;
}

export interface AutostartDependencies {
  development: boolean;
  loginAppId?: string;
  settings: Pick<Settings, "list" | "get">;
  sessions: AutostartSessions;
  processes: AutostartProcesses;
  developmentApps: DevelopmentAutostart;
}
