#!/usr/bin/env node

import { spawn } from "node:child_process";

const electronArgs = process.argv
  .slice(2)
  .filter((arg, index) => !(index === 0 && arg === "--"));
const SHUTDOWN_TIMEOUT_MS = 5000;

const prepare = spawn("pnpm", ["run", "dev:prepare"], {
  stdio: "inherit",
  shell: false,
});

prepare.on("exit", (code) => {
  if (code !== 0) {
    process.exit(code ?? 1);
    return;
  }

  const watch = spawn(
    "eden-build",
    ["watch", "-c", "eden.dev.config.json", "--sdk-source-path", "."],
    {
      stdio: "inherit",
      shell: false,
      detached: true,
    },
  );

  const electron = spawn(
    "pnpm",
    ["exec", "electron", ...electronArgs, "dist/dev-host.js"],
    {
      stdio: "inherit",
      shell: false,
      env: { ...process.env, NODE_ENV: "development" },
    },
  );

  let shuttingDown = false;
  let watchExited = false;
  let electronExited = false;

  const signalProcessGroup = (child, signal) => {
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, signal);
    } catch {
      try {
        child.kill(signal);
      } catch {
        // Process already exited.
      }
    }
  };

  const waitForExit = (isExited) =>
    new Promise((resolve) => {
      if (isExited()) {
        resolve();
        return;
      }
      const timeout = setTimeout(resolve, SHUTDOWN_TIMEOUT_MS);
      watch.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });

  const stopWatch = async () => {
    if (watchExited) return;
    signalProcessGroup(watch, "SIGTERM");
    await waitForExit(() => watchExited);
    if (!watchExited) {
      signalProcessGroup(watch, "SIGKILL");
    }
  };

  const shutdown = async (code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (!electronExited) {
      electron.kill();
    }
    await stopWatch();
    process.exit(code ?? 0);
  };

  process.once("SIGINT", () => void shutdown(130));
  process.once("SIGTERM", () => void shutdown(143));

  watch.on("exit", (code) => {
    watchExited = true;
    if (!shuttingDown && code !== 0 && code !== null) {
      void shutdown(code);
    }
  });

  electron.on("exit", (code) => {
    electronExited = true;
    void shutdown(code ?? 0);
  });
});
