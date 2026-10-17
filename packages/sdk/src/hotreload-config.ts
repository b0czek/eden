/**
 * Hot reload state helpers.
 *
 * Runtime state is shared with `eden-build watch` through files in the
 * consumer project, not inside the installed SDK package.
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { EdenConfig } from "@edenapp/types";
import * as Effect from "effect/Effect";
import { asError, fromPromise } from "./effects/io";

export interface HotReloadEnabledState {
  apps: string[];
}

export interface HotReloadServerState {
  apps: Record<string, HotReloadAppServerState>;
}

export interface HotReloadAppsState {
  protocolVersion: number;
  apps: Array<{
    id: string;
    sourcePath: string;
    launchOnStart: boolean;
  }>;
}

export interface HotReloadAppServerState {
  appId: string;
  sourcePath: string;
  port: number;
  url: string;
  status: "starting" | "ready" | "error";
  updatedAt: number;
  revision?: number;
  error?: string;
}

const HOT_RELOAD_DIR = ".eden-hot-reload";
const ENABLED_FILE = "enabled.json";
const SERVERS_FILE = "servers.json";
const APPS_FILE = "apps.json";
export const HOT_RELOAD_PROTOCOL_VERSION = 1;

export function isHotReloadConfigured(config: EdenConfig): boolean {
  return config.hotReload?.enabled ?? config.development === true;
}

export function getHotReloadStateDirectory(config?: EdenConfig): string {
  const configured = config?.hotReload?.stateDirectory;
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.resolve(process.cwd(), configured);
  }

  return path.join(process.cwd(), HOT_RELOAD_DIR);
}

export function getHotReloadEnabledPath(config?: EdenConfig): string {
  return path.join(getHotReloadStateDirectory(config), ENABLED_FILE);
}

export function getHotReloadServersPath(config?: EdenConfig): string {
  return path.join(getHotReloadStateDirectory(config), SERVERS_FILE);
}

export function getHotReloadAppsPath(config?: EdenConfig): string {
  return path.join(getHotReloadStateDirectory(config), APPS_FILE);
}

function readState<A>(
  filePath: string,
  decode: (value: unknown) => A,
  fallback: A,
) {
  return fromPromise(() => fs.readFile(filePath, "utf-8")).pipe(
    Effect.flatMap((content) =>
      Effect.try({ try: () => decode(JSON.parse(content)), catch: asError }),
    ),
    Effect.catch(() => Effect.succeed(fallback)),
  );
}

export function loadHotReloadAppsState(config?: EdenConfig) {
  return readState(
    getHotReloadAppsPath(config),
    (value): HotReloadAppsState => {
      const parsed = value as Partial<HotReloadAppsState>;
      if (
        parsed.protocolVersion !== HOT_RELOAD_PROTOCOL_VERSION ||
        !Array.isArray(parsed.apps)
      )
        return { protocolVersion: HOT_RELOAD_PROTOCOL_VERSION, apps: [] };
      return {
        protocolVersion: HOT_RELOAD_PROTOCOL_VERSION,
        apps: parsed.apps.filter(
          (entry) =>
            !!entry &&
            typeof entry.id === "string" &&
            typeof entry.sourcePath === "string" &&
            typeof entry.launchOnStart === "boolean",
        ),
      };
    },
    { protocolVersion: HOT_RELOAD_PROTOCOL_VERSION, apps: [] },
  );
}

export function loadHotReloadEnabledState(config?: EdenConfig) {
  return readState(
    getHotReloadEnabledPath(config),
    (value): HotReloadEnabledState => {
      const parsed = value as Partial<HotReloadEnabledState>;
      return { apps: Array.isArray(parsed.apps) ? parsed.apps : [] };
    },
    { apps: [] },
  );
}

export function saveHotReloadEnabledState(
  state: HotReloadEnabledState,
  config?: EdenConfig,
) {
  return writeJsonAtomic(getHotReloadEnabledPath(config), {
    apps: [...new Set(state.apps)].sort(),
  });
}

export function loadHotReloadServerState(config?: EdenConfig) {
  return readState(
    getHotReloadServersPath(config),
    (value): HotReloadServerState => {
      const parsed = value as Partial<HotReloadServerState>;
      return {
        apps:
          parsed.apps &&
          typeof parsed.apps === "object" &&
          !Array.isArray(parsed.apps)
            ? parsed.apps
            : {},
      };
    },
    { apps: {} },
  );
}

export const getHotReloadDevUrl = Effect.fn(function* (
  appId: string,
  config?: EdenConfig,
) {
  const state = yield* loadHotReloadServerState(config);
  const appState = state.apps[appId];
  return appState?.status === "ready" && appState.url
    ? appState.url
    : undefined;
});

export const isHotReloadEnabled = Effect.fn(function* (
  appId: string,
  config?: EdenConfig,
) {
  const state = yield* loadHotReloadEnabledState(config);
  return state.apps.includes(appId);
});

export const toggleHotReload = Effect.fn(function* (
  appId: string,
  config?: EdenConfig,
) {
  const state = yield* loadHotReloadEnabledState(config);
  const enabledApps = new Set(state.apps);
  const enabled = !enabledApps.has(appId);
  if (enabled) enabledApps.add(appId);
  else enabledApps.delete(appId);
  yield* saveHotReloadEnabledState({ apps: [...enabledApps] }, config);
  return enabled;
});

export const getHotReloadApps = Effect.fn(function* (config?: EdenConfig) {
  return (yield* loadHotReloadEnabledState(config)).apps;
});

const writeJsonAtomic = Effect.fn(function* (filePath: string, value: unknown) {
  yield* fromPromise(() =>
    fs.mkdir(path.dirname(filePath), { recursive: true }),
  );
  const tempPath = yield* Effect.acquireRelease(
    Effect.sync(() => `${filePath}.${randomUUID()}.tmp`),
    (temporary) =>
      fromPromise(() => fs.rm(temporary, { force: true })).pipe(Effect.orDie),
  );
  yield* fromPromise(() =>
    fs.writeFile(tempPath, JSON.stringify(value, null, 2), "utf-8"),
  );
  yield* fromPromise(() => fs.rename(tempPath, filePath));
}, Effect.scoped);
