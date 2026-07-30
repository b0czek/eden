import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import * as fs from "node:fs/promises";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import type { AppManifest, EdenSeedConfig } from "@edenapp/types";

const PROTOCOL_VERSION = 1;
const READY_TIMEOUT_MS = 30_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;

const DEVELOPMENT_USER = {
  username: "demo",
  name: "Demo User",
  password: "demo",
} as const;

export interface StandaloneDevOptions {
  appDirectory?: string;
  hostVersion?: string;
  hostPath?: string;
  offline?: boolean;
  reset?: boolean;
}

interface ManagedProcess {
  label: string;
  child: ChildProcess;
  expectedExit: boolean;
}

export async function standaloneDev(
  options: StandaloneDevOptions,
): Promise<void> {
  const appDirectory = path.resolve(options.appDirectory ?? process.cwd());
  const manifestPath = path.join(appDirectory, "manifest.json");
  const manifest = JSON.parse(
    await fs.readFile(manifestPath, "utf-8"),
  ) as AppManifest;
  if (!manifest.id || (!manifest.frontend && !manifest.backend)) {
    throw new Error(
      "manifest.json must define an id and at least one frontend or backend",
    );
  }

  const profileDirectory = path.join(appDirectory, ".eden-dev");
  const stateDirectory = path.join(profileDirectory, "hot-reload");
  const seedPath = path.join(profileDirectory, "eden-seed.json");
  if (options.reset)
    await fs.rm(profileDirectory, { recursive: true, force: true });
  await fs.mkdir(stateDirectory, { recursive: true });

  // Seed a development user so the fresh profile can sign in.
  // Seeding is idempotent in the host; --reset wipes the profile and re-seeds.
  await writeJsonAtomic(seedPath, developmentSeed());

  const port = await findAvailablePort(5173);
  const frontend = await resolveFrontend(manifest, appDirectory, port);
  const backend = await resolveBackend(manifest, appDirectory);
  let revision = 1;
  let stopping = false;
  const processes: ManagedProcess[] = [];

  await writeJsonAtomic(path.join(stateDirectory, "apps.json"), {
    protocolVersion: PROTOCOL_VERSION,
    apps: [{ id: manifest.id, sourcePath: appDirectory, launchOnStart: true }],
  });
  await writeJsonAtomic(path.join(stateDirectory, "enabled.json"), {
    apps: [manifest.id],
  });

  if (backend)
    processes.push(startCommand("backend", backend.command, backend.cwd));
  if (frontend) {
    await writeServerState(
      stateDirectory,
      manifest.id,
      frontend.url,
      port,
      "starting",
      revision,
    );
    const process = startCommand("frontend", frontend.command, frontend.cwd);
    processes.push(process);
    try {
      await waitForUrl(frontend.url, READY_TIMEOUT_MS, process.child);
    } catch (error) {
      await cleanupProcesses(processes);
      throw error;
    }
    await writeServerState(
      stateDirectory,
      manifest.id,
      frontend.url,
      port,
      "ready",
      revision,
    );
    console.log(`✅ Renderer ready at ${frontend.url}`);
  } else {
    await writeServerState(
      stateDirectory,
      manifest.id,
      "",
      port,
      "ready",
      revision,
    );
  }

  let hostExecutable: Awaited<ReturnType<typeof resolveHostExecutable>>;
  try {
    hostExecutable = await resolveHostExecutable(options);
  } catch (error) {
    await cleanupProcesses(processes);
    throw error;
  }
  const host = startExecutable(
    "host",
    hostExecutable.command,
    hostExecutable.args,
    hostExecutable.cwd,
    {
      EDEN_DEV_APPS_DIRECTORY: path.join(profileDirectory, "apps"),
      EDEN_DEV_USER_DIRECTORY: path.join(profileDirectory, "user"),
      EDEN_DEV_HOT_RELOAD_DIRECTORY: stateDirectory,
      EDEN_DEV_SEED_PATH: seedPath,
    },
  );
  processes.push(host);
  console.log(`🌱 Mounted ${manifest.id} from ${appDirectory}`);
  console.log(
    `👤 Auto-signing in as "${DEVELOPMENT_USER.username}" (password: "${DEVELOPMENT_USER.password}")`,
  );

  let failSession: (error: Error) => void = () => undefined;
  const completion = new Promise<never>((_resolve, reject) => {
    failSession = reject;
    for (const managed of processes) {
      managed.child.once("exit", (code, signal) => {
        if (!stopping && !managed.expectedExit) {
          reject(
            new Error(
              `${managed.label} exited unexpectedly (${signal ?? code ?? "unknown"})`,
            ),
          );
        }
      });
    }
  });

  const watched = new Map<string, number>();
  const watchPaths = [manifestPath];
  if (manifest.backend?.entry)
    watchPaths.push(path.resolve(appDirectory, manifest.backend.entry));
  const interval = setInterval(async () => {
    let changed = false;
    for (const file of watchPaths) {
      const mtime = await fs
        .stat(file)
        .then((s) => s.mtimeMs)
        .catch(() => 0);
      const previous = watched.get(file);
      watched.set(file, mtime);
      if (previous !== undefined && previous !== mtime) changed = true;
    }
    if (changed) {
      const currentManifest = JSON.parse(
        await fs.readFile(manifestPath, "utf-8"),
      ) as AppManifest;
      if (
        currentManifest.id !== manifest.id ||
        JSON.stringify(currentManifest.development) !==
          JSON.stringify(manifest.development)
      ) {
        failSession(
          new Error(
            "The app ID or development commands changed; restart eden-build dev",
          ),
        );
        return;
      }
      revision++;
      await writeServerState(
        stateDirectory,
        manifest.id,
        frontend?.url ?? "",
        port,
        "ready",
        revision,
      );
      console.log(`♻️  Reloading ${manifest.id} (revision ${revision})`);
    }
  }, 400);

  const stop = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(interval);
    for (const managed of processes.reverse()) {
      managed.expectedExit = true;
      await terminate(managed.child);
    }
    await writeJsonAtomic(path.join(stateDirectory, "apps.json"), {
      protocolVersion: PROTOCOL_VERSION,
      apps: [],
    });
    await writeJsonAtomic(path.join(stateDirectory, "servers.json"), {
      apps: {},
    });
  };
  process.once("SIGINT", () => void stop().then(() => process.exit(0)));
  process.once("SIGTERM", () => void stop().then(() => process.exit(0)));
  try {
    await completion;
  } finally {
    await stop();
  }
}

async function resolveFrontend(
  manifest: AppManifest,
  appDirectory: string,
  port: number,
) {
  if (!manifest.frontend) return undefined;
  const configured = manifest.development?.frontend;
  if (configured) {
    return {
      command: substitutePort(configured.command, port),
      cwd: path.resolve(appDirectory, configured.cwd ?? "."),
      url: substitutePort(configured.url, port),
    };
  }
  for (const relative of [".", "frontend"]) {
    const cwd = path.resolve(appDirectory, relative);
    const pkg = await readPackageJson(cwd);
    if (typeof pkg?.scripts?.dev === "string") {
      return {
        command: `${packageManagerFor(cwd)} run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
        cwd,
        url: `http://127.0.0.1:${port}`,
      };
    }
  }
  throw new Error(
    "No frontend development command found (expected scripts.dev in root or frontend/)",
  );
}

async function resolveBackend(manifest: AppManifest, appDirectory: string) {
  if (!manifest.backend) return undefined;
  const configured = manifest.development?.backend;
  if (configured)
    return {
      command: configured.command,
      cwd: path.resolve(appDirectory, configured.cwd ?? "."),
    };
  const nested = await readPackageJson(path.join(appDirectory, "backend"));
  if (typeof nested?.scripts?.dev === "string") {
    return {
      command: `${packageManagerFor(path.join(appDirectory, "backend"))} run dev`,
      cwd: path.join(appDirectory, "backend"),
    };
  }
  const root = await readPackageJson(appDirectory);
  if (typeof root?.scripts?.["dev:backend"] === "string") {
    return {
      command: `${packageManagerFor(appDirectory)} run dev:backend`,
      cwd: appDirectory,
    };
  }
  console.warn(
    "⚠️  No backend watch command found; using the existing compiled backend entry",
  );
  return undefined;
}

function startCommand(
  label: string,
  command: string,
  cwd: string,
): ManagedProcess {
  const child = spawn(command, {
    cwd,
    shell: true,
    stdio: "inherit",
    env: process.env,
    detached: process.platform !== "win32",
  });
  return { label, child, expectedExit: false };
}

function startExecutable(
  label: string,
  command: string,
  args: string[],
  cwd: string | undefined,
  extraEnv: NodeJS.ProcessEnv,
): ManagedProcess {
  const child = spawn(command, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
    detached: process.platform !== "win32",
  });
  return { label, child, expectedExit: false };
}

async function resolveHostExecutable(
  options: StandaloneDevOptions,
): Promise<{ command: string; args: string[]; cwd?: string }> {
  if (options.hostPath) {
    const root = path.resolve(options.hostPath);
    const packageBin = path.join(root, "bin", "eden-dev-host.js");
    if (await exists(packageBin))
      return { command: process.execPath, args: [packageBin], cwd: root };
    const sdkEntry = path.join(root, "dist", "dev-host.js");
    if (await exists(sdkEntry)) {
      const electron = path.join(
        root,
        "node_modules",
        ".bin",
        process.platform === "win32" ? "electron.cmd" : "electron",
      );
      return { command: electron, args: [sdkEntry], cwd: root };
    }
    throw new Error(
      `--host-path is not a built @edenapp/dev-host or @edenapp/sdk package: ${root}`,
    );
  }
  const version = options.hostVersion ?? (await ownVersion());
  if (!/^[0-9A-Za-z.+_-]+$/.test(version)) {
    throw new Error(`Invalid development host version: ${version}`);
  }
  const installRoot = path.join(getCacheDirectory(), "dev-host", version);
  const executable = path.join(
    installRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "eden-dev-host.cmd" : "eden-dev-host",
  );
  if (!(await exists(executable))) {
    if (options.offline)
      throw new Error(
        `@edenapp/dev-host@${version} is not cached; run once without --offline`,
      );
    const temporary = `${installRoot}.tmp-${process.pid}`;
    await fs.rm(temporary, { recursive: true, force: true });
    await fs.mkdir(temporary, { recursive: true });
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    await runChecked(npm, [
      "install",
      "--prefix",
      temporary,
      "--no-save",
      "--save-exact",
      `@edenapp/dev-host@${version}`,
    ]);
    await fs.mkdir(path.dirname(installRoot), { recursive: true });
    await fs
      .rename(temporary, installRoot)
      .catch(async (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST" && error.code !== "ENOTEMPTY") throw error;
        await fs.rm(temporary, { recursive: true, force: true });
      });
  }
  return { command: executable, args: [], cwd: installRoot };
}

function getCacheDirectory(): string {
  if (process.platform === "win32")
    return path.join(process.env.LOCALAPPDATA ?? os.tmpdir(), "Eden", "Cache");
  if (process.platform === "darwin")
    return path.join(os.homedir(), "Library", "Caches", "Eden");
  return path.join(
    process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"),
    "eden",
  );
}

async function ownVersion(): Promise<string> {
  const pkg = JSON.parse(
    await fs.readFile(path.resolve(__dirname, "..", "package.json"), "utf-8"),
  ) as { version: string };
  return pkg.version;
}

async function writeServerState(
  directory: string,
  id: string,
  url: string,
  port: number,
  status: "starting" | "ready",
  revision: number,
) {
  await writeJsonAtomic(path.join(directory, "servers.json"), {
    apps: {
      [id]: {
        appId: id,
        sourcePath: "",
        port,
        url,
        status,
        updatedAt: Date.now(),
        revision,
      },
    },
  });
}

function developmentSeed(): EdenSeedConfig {
  const passwordSalt = randomBytes(16).toString("hex");
  const passwordHash = scryptSync(
    DEVELOPMENT_USER.password,
    passwordSalt,
    64,
  ).toString("hex");
  return {
    users: [
      {
        username: DEVELOPMENT_USER.username,
        name: DEVELOPMENT_USER.name,
        role: "vendor",
        passwordHash,
        passwordSalt,
      },
    ],
    defaultUsername: DEVELOPMENT_USER.username,
    settings: {
      "com.eden": {
        "autostart.com.eden.eveshell": "true",
        "autostart.com.eden.toaster": "true",
        "autostart.com.eden.context-menu": "true",
      },
    },
  };
}

async function writeJsonAtomic(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2), "utf-8");
  await fs.rename(temporary, file);
}

async function waitForUrl(url: string, timeout: number, child: ChildProcess) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `frontend exited before becoming ready (${child.signalCode ?? child.exitCode})`,
      );
    }
    if (await requestUrl(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `frontend did not become ready within ${timeout / 1000}s: ${url}`,
  );
}

function requestUrl(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(true);
    });
    request.setTimeout(1000, () => request.destroy());
    request.once("error", () => resolve(false));
  });
}

async function findAvailablePort(start: number): Promise<number> {
  const net = await import("node:net");
  for (let port = start; port < start + 100; port++) {
    const available = await new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
    });
    if (available) return port;
  }
  throw new Error("No development port available");
}

async function readPackageJson(
  directory: string,
): Promise<{ scripts?: Record<string, unknown> } | undefined> {
  try {
    return JSON.parse(
      await fs.readFile(path.join(directory, "package.json"), "utf-8"),
    );
  } catch {
    return undefined;
  }
}
function packageManagerFor(directory: string): string {
  if (require("node:fs").existsSync(path.join(directory, "pnpm-lock.yaml")))
    return "pnpm";
  if (require("node:fs").existsSync(path.join(directory, "yarn.lock")))
    return "yarn";
  return "npm";
}
function substitutePort(value: string, port: number) {
  return value.replaceAll("{port}", String(port));
}
async function exists(file: string) {
  return fs
    .access(file)
    .then(() => true)
    .catch(() => false);
}
async function runChecked(command: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} exited with code ${code}`)),
    );
  });
}
async function terminate(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid)
    return;
  if (process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
  else child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    if (process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
    else child.kill("SIGKILL");
  }
}

async function cleanupProcesses(processes: ManagedProcess[]): Promise<void> {
  for (const managed of processes.reverse()) {
    managed.expectedExit = true;
    await terminate(managed.child);
  }
}
