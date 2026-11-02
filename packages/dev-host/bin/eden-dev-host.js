#!/usr/bin/env node

const { spawn } = require("node:child_process");
const path = require("node:path");

const sdkRoot = path.dirname(require.resolve("@edenapp/sdk/package.json"));
const electron = require("electron");
const electronArgs = process.argv.slice(2);
// The OSK needs showInactive and window positioning, which Wayland does not support.
if (
  process.platform === "linux" &&
  !electronArgs.some(
    (arg) => arg === "--ozone-platform" || arg.startsWith("--ozone-platform="),
  )
) {
  electronArgs.unshift("--ozone-platform=x11");
}
const child = spawn(
  electron,
  [...electronArgs, path.join(sdkRoot, "dist", "dev-host.js")],
  {
    cwd: sdkRoot,
    env: process.env,
    stdio: "inherit",
  },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
