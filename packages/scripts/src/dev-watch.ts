/**
 * Development Watch Script
 *
 * Supervises Vite dev servers for local Eden apps and publishes their ready
 * URLs for the SDK runtime to consume.
 */

import { type ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { type AppSource, loadConfig } from "./config";

interface HotReloadEnabledState {
  apps: string[];
}

interface HotReloadServerState {
  apps: Record<string, HotReloadAppServerState>;
}

interface HotReloadAppServerState {
  appId: string;
  sourcePath: string;
  port: number;
  url: string;
  status: "starting" | "ready" | "error";
  updatedAt: number;
  error?: string;
}

interface DevServer {
  appId: string;
  appDir: string;
  devDir: string;
  port: number;
  url: string;
  process: ChildProcess;
}

type PackageManager = "pnpm" | "yarn" | "npm";

const HOT_RELOAD_DIR = ".eden-hot-reload";
const ENABLED_FILE = "enabled.json";
const SERVERS_FILE = "servers.json";
const BASE_PORT = 5173;
const READY_TIMEOUT_MS = 30_000;
const READY_POLL_MS = 250;
const SERVER_SHUTDOWN_TIMEOUT_MS = 5000;

const DEV_SERVERS = new Map<string, DevServer>();
const STOPPING_SERVERS = new Set<string>();
let tempFileCounter = 0;

export async function devWatch(
  configPath: string = "eden.config.json",
  sdkSourcePath?: string,
) {
  console.log("🔥 Eden Hot Reload Development Server\n");

  const cwd = process.cwd();
  const config = await loadConfig(path.join(cwd, configPath));
  const hotReloadDir = resolveHotReloadStateDirectory(cwd, config);
  const enabledPath = path.join(hotReloadDir, ENABLED_FILE);
  const serversPath = path.join(hotReloadDir, SERVERS_FILE);

  if (!config.hotReload?.enabled) {
    console.log("❌ Hot reload is disabled in eden.config.json");
    return;
  }

  await fs.mkdir(hotReloadDir, { recursive: true });

  const localApps = config.apps.filter(
    (app): app is Extract<AppSource, { source: "local" }> =>
      app.source === "local",
  );
  const builtinApps = config.apps.filter(
    (app): app is Extract<AppSource, { source: "builtin" }> =>
      app.source === "builtin",
  );
  const builtinAppSources = sdkSourcePath
    ? await loadBuiltinAppSources(path.resolve(cwd, sdkSourcePath))
    : new Map<string, string>();

  if (localApps.length === 0 && builtinApps.length === 0) {
    console.log("ℹ️  No apps configured for hot reload");
  }

  await reconcileEnabledState(
    enabledPath,
    [...localApps, ...builtinApps].map((app) => app.id),
  );
  await writeServerState(serversPath, { apps: {} });

  const appById = new Map(localApps.map((app) => [app.id, app]));
  const builtinById = new Map(builtinApps.map((app) => [app.id, app]));
  const packageManager = await detectPackageManager(cwd);
  let currentApps: string[] = [];
  let lastStatus = "";
  let shuttingDown = false;
  let syncInterval: NodeJS.Timeout | undefined;

  async function loadEnabledState(): Promise<HotReloadEnabledState> {
    try {
      const content = await fs.readFile(enabledPath, "utf-8");
      const parsed = JSON.parse(content) as Partial<HotReloadEnabledState>;
      return { apps: Array.isArray(parsed.apps) ? parsed.apps : [] };
    } catch {
      return { apps: [] };
    }
  }

  async function syncServers() {
    if (shuttingDown) {
      return;
    }

    const enabled = await loadEnabledState();
    const nextApps = enabled.apps.filter((appId) => {
      if (appById.has(appId)) {
        return true;
      }
      if (builtinById.has(appId)) {
        return true;
      }
      console.warn(`⚠️  Ignoring hot reload for unsupported app: ${appId}`);
      return false;
    });
    if (nextApps.length !== enabled.apps.length) {
      await writeEnabledState(enabledPath, nextApps);
    }

    const appsToStop = currentApps.filter((appId) => !nextApps.includes(appId));
    for (const appId of appsToStop) {
      await stopServer(appId, serversPath);
    }

    const appsToStart = nextApps.filter((appId) => !DEV_SERVERS.has(appId));
    for (const appId of appsToStart) {
      const localSource = appById.get(appId);
      const builtinSource = builtinById.get(appId);
      const appDir = localSource
        ? path.isAbsolute(localSource.path)
          ? localSource.path
          : path.resolve(cwd, localSource.path)
        : builtinSource
          ? builtinAppSources.get(appId)
          : undefined;

      if (!appDir) {
        console.warn(`⚠️  Could not resolve hot reload source for ${appId}`);
        continue;
      }

      const devTarget = await resolveDevTarget(appDir);
      if (!devTarget) {
        console.warn(
          `⚠️  Skipping hot reload for ${appId}: no Vite dev target found`,
        );
        continue;
      }

      const port = allocatePort(appId);

      await startServer({
        appId,
        appDir,
        devDir: devTarget.devDir,
        packageJsonPath: devTarget.packageJsonPath,
        packageManager,
        port,
        serversPath,
      });
    }

    await refreshRunningServerReadiness(serversPath);

    currentApps = nextApps;
    lastStatus = printStatus(lastStatus);
  }

  async function cleanup() {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    if (syncInterval) {
      clearInterval(syncInterval);
      syncInterval = undefined;
    }

    for (const appId of Array.from(DEV_SERVERS.keys())) {
      await stopServer(appId, serversPath);
    }
    await writeServerState(serversPath, { apps: {} });
  }

  process.once("SIGINT", () => {
    void cleanup().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void cleanup().finally(() => process.exit(0));
  });
  process.once("exit", () => {
    for (const server of DEV_SERVERS.values()) {
      signalProcessTree(server.process, "SIGTERM");
    }
  });

  await syncServers();

  console.log(`\n👀 Watching ${path.relative(cwd, enabledPath)}`);
  syncInterval = setInterval(
    () => {
      void syncServers().catch((error) => {
        console.error("Error syncing hot reload servers:", error);
      });
    },
    Math.max(config.hotReload.debounce ?? 300, 300),
  );
}

function resolveHotReloadStateDirectory(
  cwd: string,
  config: { hotReload?: { stateDirectory?: string } },
): string {
  const configured = config.hotReload?.stateDirectory;
  if (!configured) {
    return path.join(cwd, HOT_RELOAD_DIR);
  }
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(cwd, configured);
}

async function reconcileEnabledState(
  enabledPath: string,
  defaultApps: string[],
): Promise<void> {
  try {
    const content = await fs.readFile(enabledPath, "utf-8");
    const parsed = JSON.parse(content) as Partial<HotReloadEnabledState>;
    const configuredApps = new Set(defaultApps);
    const currentApps = Array.isArray(parsed.apps) ? parsed.apps : [];
    const nextApps = currentApps.filter((appId) => configuredApps.has(appId));

    if (
      nextApps.length !== currentApps.length ||
      nextApps.some((appId, index) => appId !== currentApps[index])
    ) {
      await writeEnabledState(enabledPath, nextApps);
    }
  } catch {
    await writeEnabledState(enabledPath, defaultApps);
    if (defaultApps.length > 0) {
      console.log(`Enabled hot reload for apps: ${defaultApps.join(", ")}`);
    }
  }
}

async function writeEnabledState(
  enabledPath: string,
  apps: string[],
): Promise<void> {
  await writeJsonAtomic(enabledPath, { apps: [...new Set(apps)] });
}

function allocatePort(appId: string): number {
  const existing = DEV_SERVERS.get(appId);
  if (existing) return existing.port;

  const usedPorts = new Set(
    Array.from(DEV_SERVERS.values()).map((s) => s.port),
  );
  let port = BASE_PORT;
  while (usedPorts.has(port)) {
    port++;
  }
  return port;
}

async function startServer(options: {
  appId: string;
  appDir: string;
  devDir: string;
  packageJsonPath: string;
  packageManager: PackageManager;
  port: number;
  serversPath: string;
}): Promise<void> {
  const {
    appId,
    appDir,
    devDir,
    packageJsonPath,
    packageManager,
    port,
    serversPath,
  } = options;

  try {
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf-8"));
    if (!packageJson.scripts?.dev) {
      console.warn(`⚠️  Skipping hot reload for ${appId}: missing dev script`);
      return;
    }
  } catch {
    console.warn(
      `⚠️  Skipping hot reload for ${appId}: cannot read ${packageJsonPath}`,
    );
    return;
  }

  const url = `http://localhost:${port}`;
  console.log(`🚀 Starting ${appId} at ${url}`);

  await updateServerEntry(serversPath, appId, {
    appId,
    sourcePath: appDir,
    port,
    url,
    status: "starting",
    updatedAt: Date.now(),
  });

  const serverProcess = spawn(
    packageManager,
    [
      "run",
      "dev",
      "--",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    {
      cwd: devDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, BROWSER: "none" },
      detached: true,
    },
  );

  const server: DevServer = {
    appId,
    appDir,
    devDir,
    port,
    url,
    process: serverProcess,
  };
  DEV_SERVERS.set(appId, server);

  serverProcess.stdout?.on("data", (data) => {
    const output = data.toString();
    if (output.toLowerCase().includes("error")) {
      process.stdout.write(`[${appId}] ${output}`);
    }
  });

  serverProcess.stderr?.on("data", (data) => {
    const output = data.toString();
    if (!output.includes("ExperimentalWarning")) {
      process.stderr.write(`[${appId}] ${output}`);
    }
  });

  serverProcess.once("exit", (code) => {
    DEV_SERVERS.delete(appId);
    if (STOPPING_SERVERS.has(appId)) {
      STOPPING_SERVERS.delete(appId);
      return;
    }
    void updateServerEntry(serversPath, appId, {
      appId,
      sourcePath: appDir,
      port,
      url,
      status: "error",
      updatedAt: Date.now(),
      error: `dev server exited with code ${code ?? "null"}`,
    }).catch((error) => {
      console.warn(
        `⚠️  Could not update hot reload state for ${appId}: ${getErrorMessage(error)}`,
      );
    });
    if (code !== 0 && code !== null) {
      console.log(`⚠️  ${appId} dev server exited with code ${code}`);
    }
  });

  try {
    await waitForServer(url);
    await updateServerEntry(serversPath, appId, {
      appId,
      sourcePath: appDir,
      port,
      url,
      status: "ready",
      updatedAt: Date.now(),
    });
    console.log(`✅ ${appId} ready at ${url}`);
  } catch (error) {
    await updateServerEntry(serversPath, appId, {
      appId,
      sourcePath: appDir,
      port,
      url,
      status: "error",
      updatedAt: Date.now(),
      error: getErrorMessage(error),
    });
    console.error(
      `❌ ${appId} did not become ready: ${getErrorMessage(error)}`,
    );
  }
}

async function resolveDevTarget(appDir: string): Promise<{
  devDir: string;
  packageJsonPath: string;
} | null> {
  const candidates = [
    { devDir: appDir, packageJsonPath: path.join(appDir, "package.json") },
    {
      devDir: path.join(appDir, "frontend"),
      packageJsonPath: path.join(appDir, "frontend", "package.json"),
    },
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate.packageJsonPath);
      return candidate;
    } catch {
      // Try next candidate.
    }
  }

  return null;
}

async function loadBuiltinAppSources(
  sdkSourcePath: string,
): Promise<Map<string, string>> {
  const appsDir = path.join(sdkSourcePath, "apps");
  const result = new Map<string, string>();

  async function scan(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        entry.name === "node_modules" ||
        entry.name === "dist"
      ) {
        continue;
      }

      const subDir = path.join(dir, entry.name);
      const manifestPath = path.join(subDir, "manifest.json");

      try {
        const manifestContent = await fs.readFile(manifestPath, "utf-8");
        const manifest = JSON.parse(manifestContent) as { id?: string };
        if (manifest.id) {
          result.set(manifest.id, subDir);
        }
        continue;
      } catch {
        // Not an app root, keep scanning.
      }

      await scan(subDir);
    }
  }

  try {
    await scan(appsDir);
  } catch {
    console.warn(`⚠️  Could not scan SDK apps directory: ${appsDir}`);
  }

  return result;
}

async function stopServer(appId: string, serversPath: string): Promise<void> {
  const server = DEV_SERVERS.get(appId);
  if (server) {
    console.log(`⏹️  Stopping ${appId}`);
    STOPPING_SERVERS.add(appId);
    DEV_SERVERS.delete(appId);
    await terminateProcessTree(server.process);
  }
  await removeServerEntry(serversPath, appId);
}

async function terminateProcessTree(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null || process.signalCode !== null) {
    return;
  }

  signalProcessTree(process, "SIGTERM");
  await waitForProcessExit(process, SERVER_SHUTDOWN_TIMEOUT_MS);

  if (process.exitCode === null && process.signalCode === null) {
    signalProcessTree(process, "SIGKILL");
    await waitForProcessExit(process, 1000);
  }
}

function signalProcessTree(
  process: ChildProcess,
  signal: NodeJS.Signals,
): void {
  if (process.pid === undefined) return;

  try {
    globalThis.process.kill(-process.pid, signal);
  } catch {
    try {
      process.kill(signal);
    } catch {
      // Process already exited.
    }
  }
}

function waitForProcessExit(
  process: ChildProcess,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve) => {
    if (process.exitCode !== null || process.signalCode !== null) {
      resolve();
      return;
    }

    const timeout = setTimeout(resolve, timeoutMs);
    process.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function waitForServer(url: string): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < READY_TIMEOUT_MS) {
    if (await isServerReachable(url)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
  throw new Error(`timed out waiting for ${url}`);
}

async function isServerReachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

async function refreshRunningServerReadiness(
  serversPath: string,
): Promise<void> {
  const state = await readServerState(serversPath);

  for (const server of DEV_SERVERS.values()) {
    if (state.apps[server.appId]?.status === "ready") {
      continue;
    }

    if (!(await isServerReachable(server.url))) {
      continue;
    }

    await updateServerEntry(serversPath, server.appId, {
      appId: server.appId,
      sourcePath: server.appDir,
      port: server.port,
      url: server.url,
      status: "ready",
      updatedAt: Date.now(),
    });
    console.log(`✅ ${server.appId} ready at ${server.url}`);
  }
}

async function detectPackageManager(cwd: string): Promise<PackageManager> {
  const candidates: Array<[PackageManager, string]> = [
    ["pnpm", "pnpm-lock.yaml"],
    ["yarn", "yarn.lock"],
    ["npm", "package-lock.json"],
  ];

  for (const [manager, lockfile] of candidates) {
    try {
      await fs.access(path.join(cwd, lockfile));
      return manager;
    } catch {
      // Try next lockfile.
    }
  }

  return "npm";
}

async function readServerState(
  serversPath: string,
): Promise<HotReloadServerState> {
  try {
    const content = await fs.readFile(serversPath, "utf-8");
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

async function writeServerState(
  serversPath: string,
  state: HotReloadServerState,
): Promise<void> {
  await writeJsonAtomic(serversPath, state);
}

async function updateServerEntry(
  serversPath: string,
  appId: string,
  entry: HotReloadAppServerState,
): Promise<void> {
  const state = await readServerState(serversPath);
  state.apps[appId] = entry;
  await writeServerState(serversPath, state);
}

async function removeServerEntry(
  serversPath: string,
  appId: string,
): Promise<void> {
  const state = await readServerState(serversPath);
  delete state.apps[appId];
  await writeServerState(serversPath, state);
}

async function writeJsonAtomic(
  filePath: string,
  value: unknown,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${tempFileCounter++}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(value, null, 2), "utf-8");
  await fs.rename(tempPath, filePath);
}

function printStatus(lastStatus: string): string {
  if (DEV_SERVERS.size === 0) {
    const status = "none";
    if (lastStatus !== status) {
      console.log("ℹ️  No local apps currently enabled for hot reload");
    }
    return status;
  }

  const apps = Array.from(DEV_SERVERS.values()).map(
    (server) => `${server.appId} (${server.url})`,
  );
  const status = apps.join(", ");
  if (lastStatus !== status) {
    console.log(`🔥 Hot reload servers: ${status}`);
  }
  return status;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
