#!/usr/bin/env node

const { spawn } = require("node:child_process");
const path = require("node:path");

const sdkRoot = path.dirname(require.resolve("@edenapp/sdk/package.json"));
const electron = require("electron");
const child = spawn(electron, [path.join(sdkRoot, "dist", "dev-host.js")], {
  cwd: sdkRoot,
  env: process.env,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
