import * as os from "node:os";
import * as path from "node:path";
import type * as EffectModule from "effect/Effect";
import type { EdenRuntime } from "../src/runtime/runtime";
import { APP_ID } from "../tests/electron/support/fixtures";
import { createElectronHost } from "../tests/electron/support/host";
import { disposeElectronProfile } from "../tests/electron/support/profile";

// Build the SDK first. On headless Linux:
// xvfb-run -a pnpm exec ts-node scripts/benchmark-edenapi.ts
async function main() {
  const asynchronous = process.argv.includes("--async");
  const host = await createElectronHost({ fixtures: ["integration"] });
  try {
    const electronApp = host.electronApp;
    if (!electronApp) throw new Error("Electron host is unavailable");
    await electronApp.evaluate(
      (_electron, { controllerPath, asynchronous }) => {
        const { command, defineController } = process
          .getBuiltinModule("module")
          .createRequire(controllerPath)(controllerPath);
        const { runtime, Effect } = (
          globalThis as typeof globalThis & {
            __edenIntegration: {
              runtime: EdenRuntime;
              Effect: typeof EffectModule;
            };
          }
        ).__edenIntegration;
        runtime.services.commands.registerController(
          defineController("benchmark", {
            commands: {
              empty: command({
                handle: () =>
                  asynchronous
                    ? Effect.promise(() => Promise.resolve(undefined))
                    : undefined,
              }),
            },
          }),
        );
      },
      {
        controllerPath: path.resolve(
          __dirname,
          "../dist/controllers/controller.js",
        ),
        asynchronous,
      },
    );
    await host.launchFixture();
    const results = await host.evaluateApp(
      APP_ID,
      `(${async () => {
        const api = (
          globalThis as typeof globalThis & {
            edenAPI: {
              shellCommand(command: string, args: object): Promise<unknown>;
            };
          }
        ).edenAPI;
        const measurements = [];
        for (const concurrency of [1, 8, 32, 128]) {
          const samples = [];
          // Warm each concurrency level before recording five one-second samples.
          for (let sample = -1; sample < 5; sample++) {
            const started = performance.now();
            const deadline = started + (sample < 0 ? 500 : 1000);
            let completed = 0;
            await Promise.all(
              Array.from({ length: concurrency }, async () => {
                do {
                  const result = await api.shellCommand("benchmark/empty", {});
                  if (result !== undefined)
                    throw new Error("Unexpected empty response");
                  completed++;
                } while (performance.now() < deadline);
              }),
            );
            const elapsedMs = performance.now() - started;
            if (sample >= 0) samples.push((completed * 1000) / elapsedMs);
          }
          const sorted = [...samples].sort((a, b) => a - b);
          measurements.push({ concurrency, median: sorted[2], samples });
        }
        return measurements;
      }})()`,
    );
    console.log(
      JSON.stringify(
        {
          cpu: os.cpus()[0].model,
          node: process.version,
          endpoint: asynchronous ? "async" : "sync",
          results,
        },
        null,
        2,
      ),
    );
  } finally {
    await host.electronApp?.close();
    await disposeElectronProfile(host);
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
