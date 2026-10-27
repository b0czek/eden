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
  state: HotReloadAppServerState;
  process?: ChildProcess;
  stopping?: Promise<void>;
}

type PackageManager = "pnpm" | "yarn" | "npm";

const HOT_RELOAD_DIR = ".eden-hot-reload";
const ENABLED_FILE = "enabled.json";
const SERVERS_FILE = "servers.json";
const BASE_PORT = 5173;
const READY_TIMEOUT_MS = 30_000;
const SERVER_SHUTDOWN_TIMEOUT_MS = 5000;

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
  await writeJsonAtomic(serversPath, { apps: {} });

  const appById = new Map(localApps.map((app) => [app.id, app]));
  const builtinById = new Map(builtinApps.map((app) => [app.id, app]));
  const packageManager = await detectPackageManager(cwd);
  const servers = new Map<string, DevServer>();
  let publication = Promise.resolve();
  let lastPublished = "";
  let syncing = false;
  let lastStatus = "";
  let shuttingDown = false;
  let syncInterval: NodeJS.Timeout | undefined;

  function publishServers(): Promise<void> {
    // Child exits can publish while reconciliation is awaiting I/O.
    publication = publication
      .catch(() => {})
      .then(async () => {
        const snapshot = {
          apps: Object.fromEntries(
            Array.from(servers, ([appId, server]) => [appId, server.state]),
          ),
        };
        const serialized = JSON.stringify(snapshot);
        if (serialized === lastPublished) return;
        await writeJsonAtomic(serversPath, snapshot);
        lastPublished = serialized;
      });
    return publication;
  }

  function serverFailed(server: DevServer, error: string) {
    server.process = undefined;
    if (server.stopping || servers.get(server.state.appId) !== server) return;
    server.state = {
      ...server.state,
      status: "error",
      error,
      updatedAt: Date.now(),
    };
    void publishServers().catch((error) => {
      console.warn(
        `⚠️  Could not update hot reload state: ${getErrorMessage(error)}`,
      );
    });
  }

  async function stopServer(appId: string) {
    const server = servers.get(appId);
    if (!server) return;
    // Keep ownership until termination completes so shutdown can await it too.
    server.stopping ??= (async () => {
      console.log(`⏹️  Stopping ${appId}`);
      if (server.process) await terminateProcessTree(server.process);
      servers.delete(appId);
    })();
    await server.stopping;
  }

  async function startServer(appId: string, appDir: string) {
    const target = await resolveDevTarget(appDir);
    if (!target) {
      console.warn(
        `⚠️  Skipping hot reload for ${appId}: no Vite dev target found`,
      );
      return;
    }
    try {
      const packageJson = JSON.parse(
        await fs.readFile(target.packageJsonPath, "utf-8"),
      );
      if (!packageJson.scripts?.dev) {
        console.warn(`⚠️  Skipping hot reload for ${appId}: missing dev script`);
        return;
      }
    } catch {
      console.warn(
        `⚠️  Skipping hot reload for ${appId}: cannot read ${target.packageJsonPath}`,
      );
      return;
    }
    if (shuttingDown) return;

    const usedPorts = new Set(
      Array.from(servers.values(), (server) => server.state.port),
    );
    let port = servers.get(appId)?.state.port ?? BASE_PORT;
    if (!servers.has(appId)) {
      while (usedPorts.has(port)) port++;
    }
    const url = `http://localhost:${port}`;
    console.log(`🚀 Starting ${appId} at ${url}`);
    const child = spawn(
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
        cwd: target.devDir,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, BROWSER: "none" },
        detached: true,
      },
    );
    const server: DevServer = {
      state: {
        appId,
        sourcePath: appDir,
        port,
        url,
        status: "starting",
        updatedAt: Date.now(),
      },
      process: child,
    };
    servers.set(appId, server);
    child.stdout?.on("data", (data) => {
      const output = data.toString();
      if (output.toLowerCase().includes("error"))
        process.stdout.write(`[${appId}] ${output}`);
    });
    child.stderr?.on("data", (data) => {
      const output = data.toString();
      if (!output.includes("ExperimentalWarning"))
        process.stderr.write(`[${appId}] ${output}`);
    });
    child.once("error", (error) =>
      serverFailed(server, getErrorMessage(error)),
    );
    child.once("exit", (code) => {
      serverFailed(server, `dev server exited with code ${code ?? "null"}`);
      if (code !== 0 && code !== null)
        console.log(`⚠️  ${appId} dev server exited with code ${code}`);
    });
  }

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
    if (shuttingDown || syncing) return;
    syncing = true;
    try {
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

      for (const appId of servers.keys()) {
        if (!nextApps.includes(appId)) await stopServer(appId);
      }

      for (const appId of new Set(nextApps)) {
        if (shuttingDown) return;
        if (servers.get(appId)?.process) continue;
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

        await startServer(appId, appDir);
      }

      for (const server of servers.values()) {
        if (shuttingDown) return;
        if (!server.process || server.state.status === "ready") continue;
        const reachable = await isServerReachable(server.state.url);
        if (shuttingDown || !server.process) continue;
        if (reachable) {
          const { error: _error, ...state } = server.state;
          server.state = { ...state, status: "ready", updatedAt: Date.now() };
          console.log(`✅ ${state.appId} ready at ${state.url}`);
        } else if (
          server.state.status === "starting" &&
          Date.now() - server.state.updatedAt >= READY_TIMEOUT_MS
        ) {
          server.state = {
            ...server.state,
            status: "error",
            error: `timed out waiting for ${server.state.url}`,
            updatedAt: Date.now(),
          };
          console.error(
            `❌ ${server.state.appId} did not become ready: ${server.state.error}`,
          );
        }
      }

      if (shuttingDown) return;
      await publishServers();
      lastStatus = printStatus(servers, lastStatus);
    } finally {
      syncing = false;
    }
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

    for (const appId of servers.keys()) {
      await stopServer(appId);
    }
    await publishServers();
  }

  const onSignal = () => {
    if (!shuttingDown) void cleanup().finally(() => process.exit(0));
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  process.once("exit", () => {
    for (const server of servers.values()) {
      if (server.process) signalProcessTree(server.process, "SIGTERM");
    }
  });

  await syncServers();
  if (shuttingDown) return;

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

async function isServerReachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
    return response.ok || response.status < 500;
  } catch {
    return false;
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

async function writeJsonAtomic(
  filePath: string,
  value: unknown,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${tempFileCounter++}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(value, null, 2), "utf-8");
  await fs.rename(tempPath, filePath);
}

function printStatus(
  servers: Map<string, DevServer>,
  lastStatus: string,
): string {
  const running = Array.from(servers.values()).filter(
    (server) => server.process,
  );
  if (running.length === 0) {
    const status = "none";
    if (lastStatus !== status) {
      console.log("ℹ️  No local apps currently enabled for hot reload");
    }
    return status;
  }

  const apps = running.map(
    (server) => `${server.state.appId} (${server.state.url})`,
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
