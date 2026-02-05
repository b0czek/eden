/**
 * Development Watch Script
 *
 * Starts Vite dev servers for Eden apps with instant HMR
 */

import * as fs from "fs/promises";
import * as path from "path";
import { spawn, ChildProcess } from "child_process";
import { loadConfig, resolveSdkAppsPath, AppSource } from "./config";

interface HotReloadConfig {
  apps: string[];
}

interface DevServer {
  appId: string;
  port: number;
  process: ChildProcess;
}

const DEV_SERVERS: DevServer[] = [];
const BASE_PORT = 5173; // Vite's default port

export async function devWatch(
  configPath: string = "eden.config.json",
  sdkPath?: string,
) {
  console.log("🔥 Eden Instant HMR Development Server\n");

  const cwd = process.cwd();
  const config = await loadConfig(path.join(cwd, configPath));
  const hotReloadConfigPath = path.join(cwd, ".eden-hra.json");

  if (!config.hotReload?.enabled) {
    console.log("❌ Hot reload is disabled in eden.config.json");
    // Don't exit process in a library function, just return
    return;
  }

  // Resolve SDK apps path for builtin apps
  const sdkAppsPath = await resolveSdkAppsPath(sdkPath);

  let currentApps: string[] = [];
  let port = BASE_PORT;

  async function loadHotReloadConfig(): Promise<HotReloadConfig> {
    try {
      const content = await fs.readFile(hotReloadConfigPath, "utf-8");
      return JSON.parse(content);
    } catch {
      return { apps: [] };
    }
  }

  async function findAppDirectory(appId: string): Promise<string | null> {
    // Determine app source from config
    const appConfig = config.apps.find((app) => app.id === appId);

    if (!appConfig) {
      // If not in config but requested via hot reload, try to find it in SDK or local
      // This is a bit tricky if we don't know the source. Default to checking SDK.
      if (sdkAppsPath) {
        const sdkDir = path.join(sdkAppsPath, ...appId.split("."));
        try {
          await fs.access(sdkDir);
          return sdkDir;
        } catch {
          // ignore
        }
      }
      return null;
    }

    // Reuse logic similar to build-apps (can export resolveAppDirectory from there later)
    if (appConfig.source === "builtin") {
      if (!sdkAppsPath) return null;
      return path.join(sdkAppsPath, ...appId.split("."));
    } else if (appConfig.source === "local") {
      return path.resolve(cwd, appConfig.path);
    } else if (appConfig.source === "npm") {
      // Basic resolution for npm packages
      try {
        const pkgPath = require.resolve(`${appConfig.package}/package.json`, {
          paths: [cwd],
        });
        return path.dirname(pkgPath);
      } catch {
        return null;
      }
    }

    return null;
  }

  async function startViteServer(
    appId: string,
    appDir: string,
    port: number,
  ): Promise<DevServer | null> {
    console.log(`🚀 Starting Vite dev server for ${appId} on port ${port}...`);

    // Check if package.json exists
    try {
      await fs.access(path.join(appDir, "package.json"));
    } catch {
      console.error(`  ❌ No package.json found for ${appId}`);
      return null;
    }

    // Start Vite dev server
    // Use npm run dev if available, otherwise assume it's a vite project
    const viteProcess = spawn(
      "npm",
      ["run", "dev", "--", "--port", port.toString(), "--strictPort"],
      {
        cwd: appDir,
        stdio: ["ignore", "pipe", "pipe"],
        shell: true,
      },
    );

    let serverReady = false;

    // Handle stdout
    viteProcess.stdout?.on("data", (data) => {
      const output = data.toString();

      // Detect when server is ready
      if (output.includes("Local:") || output.includes("ready in")) {
        if (!serverReady) {
          console.log(`  ✅ ${appId} ready at http://localhost:${port}`);
          serverReady = true;
        }
      }

      // Only show important messages (errors, warnings)
      if (output.includes("error") || output.includes("warning")) {
        process.stdout.write(`  [${appId}] ${output}`);
      }
    });

    // Handle stderr
    viteProcess.stderr?.on("data", (data) => {
      const output = data.toString();
      // Filter out noise, only show real errors
      if (
        !output.includes("EADDRINUSE") &&
        !output.includes("ExperimentalWarning")
      ) {
        process.stderr.write(`  [${appId}] ${output}`);
      }
    });

    // Handle process exit
    viteProcess.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        console.log(`  ⚠️  Vite server for ${appId} exited with code ${code}`);
      }
    });

    return {
      appId,
      port,
      process: viteProcess,
    };
  }

  async function writeDevManifest(
    appId: string,
    appDir: string,
    port: number,
  ): Promise<void> {
    const devManifestPath = path.join(appDir, ".dev-manifest.json");

    await fs.writeFile(
      devManifestPath,
      JSON.stringify(
        {
          devMode: true,
          devUrl: `http://localhost:${port}`,
          port,
        },
        null,
        2,
      ),
    );
  }

  async function syncServers() {
    const hotReloadConfig = await loadHotReloadConfig();
    const newApps = hotReloadConfig.apps;

    // Track if anything changed
    let hasChanges = false;

    // Find apps to stop
    const appsToStop = currentApps.filter((appId) => !newApps.includes(appId));
    for (const appId of appsToStop) {
      const serverIndex = DEV_SERVERS.findIndex((s) => s.appId === appId);
      if (serverIndex >= 0) {
        hasChanges = true;
        const server = DEV_SERVERS[serverIndex];
        console.log(`\n⏹️  Stopping Vite server for ${appId}...`);
        server.process.kill();
        DEV_SERVERS.splice(serverIndex, 1);

        // Clean up dev manifest
        try {
          const appDir = await findAppDirectory(appId);
          if (appDir) {
            await fs.unlink(path.join(appDir, ".dev-manifest.json"));
          }
        } catch {
          // Ignore cleanup errors
        }
      }
    }

    // Find apps to start
    const appsToStart = newApps.filter((appId) => !currentApps.includes(appId));
    if (appsToStart.length > 0) {
      hasChanges = true;
      console.log(
        `\n🚀 Starting Vite servers for ${appsToStart.length} new app(s)...\n`,
      );

      for (const appId of appsToStart) {
        // Find next available port
        port = BASE_PORT + DEV_SERVERS.length;

        const appDir = await findAppDirectory(appId);
        if (!appDir) {
          console.error(`❌ App directory not found: ${appId}`);
          continue;
        }

        // Write dev manifest
        await writeDevManifest(appId, appDir, port);

        // Start Vite server
        const server = await startViteServer(appId, appDir, port);
        if (server) {
          DEV_SERVERS.push(server);
        }
      }

      if (appsToStart.length > 0) {
        console.log("\n✅ New dev servers started");
      }
    }

    currentApps = newApps;

    // Only print status if something changed
    if (hasChanges) {
      if (DEV_SERVERS.length === 0) {
        console.log("\nℹ️  No apps enabled for hot reload");
        console.log(
          '💡 Right-click an app in Eden and select "Enable Hot Reload"',
        );
      } else {
        console.log(`\n🔥 Running ${DEV_SERVERS.length} Vite dev server(s)`);
      }
    }
  }

  // Initial sync
  await syncServers();

  // Watch config file for changes
  console.log("\n👀 Watching for hot reload config changes...");
  let checkCount = 0;
  const configWatcher = setInterval(async () => {
    try {
      checkCount++;
      // Only log every 30th check (once per minute) to avoid spam
      if (checkCount % 30 === 0) {
        console.log(
          `[DEBUG] Config check #${checkCount} (no changes detected)`,
        );
      }
      await syncServers();
    } catch (error) {
      console.error("Error syncing servers:", error);
    }
  }, 2000);

  // Return a cleanup function if needed, but in CLI mode we just wait for SIGINT
}
