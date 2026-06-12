/**
 * Hot reload state helpers.
 *
 * Runtime state is shared with `eden-build watch` through files in the
 * consumer project, not inside the installed SDK package.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { EdenConfig } from "@edenapp/types";

export interface HotReloadEnabledState {
  apps: string[];
}

export interface HotReloadServerState {
  apps: Record<string, HotReloadAppServerState>;
}

export interface HotReloadAppServerState {
  appId: string;
  sourcePath: string;
  port: number;
  url: string;
  status: "starting" | "ready" | "error";
  updatedAt: number;
  error?: string;
}

const HOT_RELOAD_DIR = ".eden-hot-reload";
const ENABLED_FILE = "enabled.json";
const SERVERS_FILE = "servers.json";

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

export async function loadHotReloadEnabledState(
  config?: EdenConfig,
): Promise<HotReloadEnabledState> {
  try {
    const content = await fs.readFile(getHotReloadEnabledPath(config), "utf-8");
    const parsed = JSON.parse(content) as Partial<HotReloadEnabledState>;
    return { apps: Array.isArray(parsed.apps) ? parsed.apps : [] };
  } catch {
    return { apps: [] };
  }
}

export async function saveHotReloadEnabledState(
  state: HotReloadEnabledState,
  config?: EdenConfig,
): Promise<void> {
  await writeJsonAtomic(getHotReloadEnabledPath(config), {
    apps: [...new Set(state.apps)].sort(),
  });
}

export async function loadHotReloadServerState(
  config?: EdenConfig,
): Promise<HotReloadServerState> {
  try {
    const content = await fs.readFile(getHotReloadServersPath(config), "utf-8");
    const parsed = JSON.parse(content) as Partial<HotReloadServerState>;
    return {
      apps:
        parsed.apps &&
        typeof parsed.apps === "object" &&
        !Array.isArray(parsed.apps)
          ? parsed.apps
          : {},
    };
  } catch {
    return { apps: {} };
  }
}

export async function getHotReloadDevUrl(
  appId: string,
  config?: EdenConfig,
): Promise<string | undefined> {
  const state = await loadHotReloadServerState(config);
  const appState = state.apps[appId];
  if (appState?.status === "ready" && appState.url) {
    return appState.url;
  }
  return undefined;
}

export async function isHotReloadEnabled(
  appId: string,
  config?: EdenConfig,
): Promise<boolean> {
  const state = await loadHotReloadEnabledState(config);
  return state.apps.includes(appId);
}

export async function toggleHotReload(
  appId: string,
  config?: EdenConfig,
): Promise<boolean> {
  const state = await loadHotReloadEnabledState(config);
  const enabledApps = new Set(state.apps);

  if (enabledApps.has(appId)) {
    enabledApps.delete(appId);
    await saveHotReloadEnabledState({ apps: Array.from(enabledApps) }, config);
    return false;
  }

  enabledApps.add(appId);
  await saveHotReloadEnabledState({ apps: Array.from(enabledApps) }, config);
  return true;
}

export async function getHotReloadApps(config?: EdenConfig): Promise<string[]> {
  const state = await loadHotReloadEnabledState(config);
  return state.apps;
}

async function writeJsonAtomic(
  filePath: string,
  value: unknown,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(value, null, 2), "utf-8");
  await fs.rename(tempPath, filePath);
}
