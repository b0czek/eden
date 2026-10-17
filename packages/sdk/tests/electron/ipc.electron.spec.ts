import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Eden } from "@edenapp/sdk";
import { expect, test } from "@playwright/test";
import { APP_ID } from "./support/fixtures";
import { useElectronHost } from "./support/host";

test.describe
  .serial("ipc through Electron", () => {
    const getHost = useElectronHost({
      fixtures: ["integration"],
      launchFixture: true,
    });
    test("executes generated client methods in the renderer with typed operation controls", async () => {
      const host = getHost();

      const result = await host.electronApp?.evaluate(
        async ({ webContents }, appId) => {
          const contents = webContents
            .getAllWebContents()
            .find((candidate) => candidate.getURL().includes(appId));
          if (!contents) throw new Error("Integration app view not found");
          return contents.executeJavaScript(`(async () => {
          const eden = window.edenClient;
          const from = { volume: "home", path: "/generated-renderer.txt" };
          const to = { volume: "home", path: "/generated-copy.txt" };
          await eden.fs.write(from, "generated client", { encoding: "utf8" });
          const options = { submission: { requestKey: "generated-copy" } };
          const copy = await eden.fs.cp(from, to, options);
          const repeated = await eden.fs.cp(from, to, options);
          await copy.result();
          return {
            sameHandle: copy.handle.id === repeated.handle.id,
            contents: await eden.fs.read(to),
            size: (await eden.fs.stat(to)).size,
            status: (await copy.get()).status,
          };
        })()`);
        },
        APP_ID,
      );
      expect(result).toEqual({
        sameHandle: true,
        contents: "generated client",
        size: 16,
        status: "succeeded",
      });
      expect(
        await fs.readFile(
          path.join(host.root, "users/generated-copy.txt"),
          "utf8",
        ),
      ).toBe("generated client");
    });

    test("accepts renderer and backend operations and observes work beyond former IPC deadlines", async () => {
      const host = getHost();

      test.setTimeout(45_000);
      await expect
        .poll(async () => {
          try {
            return await fs.readFile(
              path.join(host.fixtureDirectory, "backend-operation-ready"),
              "utf8",
            );
          } catch {
            return undefined;
          }
        })
        .toBe("ready");
      await host.electronApp?.evaluate(async (_electron, rootPath) => {
        const integration = globalThis as typeof globalThis & {
          __edenIntegration: {
            eden: Eden;
          };
        };
        await integration.__edenIntegration.eden.runPromise(
          integration.__edenIntegration.eden.volumes.register({
            id: "operation-delay",
            label: "Operation trigger",
            kind: "local",
            rootPath,
          }),
        );
      }, host.root);
      try {
        const rendererHandle = (await host.electronApp?.evaluate(
          async ({ webContents }, appId) => {
            const contents = webContents
              .getAllWebContents()
              .find((candidate) => candidate.getURL().includes(appId));
            if (!contents) throw new Error("Integration view missing");
            return contents.executeJavaScript(
              `(async () => {
                const operation = await window.edenAPI.shellCommand("integration/delayed", {name: "renderer"});
                window.__integrationOperation = operation;
                return operation.handle;
              })()`,
            );
          },
          APP_ID,
        )) as { command: string; id: string };
        expect(rendererHandle).toMatchObject({
          command: "integration/delayed",
          id: expect.any(String),
        });
        await expect
          .poll(async () => {
            try {
              return JSON.parse(
                await fs.readFile(
                  path.join(
                    host.fixtureDirectory,
                    "backend-operation-accepted.json",
                  ),
                  "utf8",
                ),
              );
            } catch {
              return undefined;
            }
          })
          .toMatchObject({
            command: "integration/delayed",
            id: expect.any(String),
          });
        await host.evaluateApp(
          APP_ID,
          `(async () => {
          window.__operationSnapshots = [];
          window.__stopOperationWatch = await window.__integrationOperation.watch(snapshot => window.__operationSnapshots.push(snapshot));
        })()`,
        );
        await expect
          .poll(() =>
            host.evaluateApp(
              APP_ID,
              `window.__operationSnapshots.some(snapshot => snapshot.status === "running" && snapshot.phase === "waiting-for-fixture")`,
            ),
          )
          .toBe(true);
        await expect
          .poll(async () => {
            try {
              return JSON.parse(
                await fs.readFile(
                  path.join(
                    host.fixtureDirectory,
                    "backend-operation-progress.json",
                  ),
                  "utf8",
                ),
              );
            } catch {
              return undefined;
            }
          })
          .toMatchObject({
            status: "running",
            phase: "waiting-for-fixture",
            revision: expect.any(Number),
          });
        await host.electronApp?.evaluate(() => {
          const integration = globalThis as typeof globalThis & {
            __edenIntegration: { releaseOperation(name: string): void };
          };
          integration.__edenIntegration.releaseOperation("renderer");
          integration.__edenIntegration.releaseOperation("backend");
        });
        const completed = await host.electronApp?.evaluate(
          async ({ webContents }, { appId, handle }) => {
            const contents = webContents
              .getAllWebContents()
              .find((candidate) => candidate.getURL().includes(appId));
            if (!contents) throw new Error("Integration view missing");
            return contents.executeJavaScript(`(async () => {
          const handle = ${JSON.stringify(handle)};
          const operation = window.__integrationOperation;
          const completion = await operation.result();
          window.__stopOperationWatch();
          const revisions = window.__operationSnapshots.map(snapshot => snapshot.revision);
          const retained = await window.edenAPI.operations.from(handle).result();
          return {completion, retained, revisions};
        })()`);
          },
          { appId: APP_ID, handle: rendererHandle },
        );
        expect(completed).toMatchObject({
          completion: { name: "renderer" },
          retained: { name: "renderer" },
          revisions: expect.arrayContaining([expect.any(Number)]),
        });
        await expect
          .poll(async () => {
            try {
              return JSON.parse(
                await fs.readFile(
                  path.join(
                    host.fixtureDirectory,
                    "backend-operation-result.json",
                  ),
                  "utf8",
                ),
              );
            } catch {
              return undefined;
            }
          })
          .toMatchObject({
            completion: { name: "backend" },
            revisions: expect.arrayContaining([expect.any(Number)]),
          });
        expect(
          await fs.readFile(
            path.join(host.root, "users", "operation-renderer.txt"),
            "utf8",
          ),
        ).toBe("renderer");
        expect(
          await fs.readFile(
            path.join(host.root, "users", "operation-backend.txt"),
            "utf8",
          ),
        ).toBe("backend");
      } finally {
        await host.electronApp?.evaluate(() => {
          const integration = globalThis as typeof globalThis & {
            __edenIntegration: {
              eden: Eden;
              releaseOperation(name: string): void;
            };
          };
          integration.__edenIntegration.releaseOperation("renderer");
          integration.__edenIntegration.releaseOperation("backend");
          integration.__edenIntegration.eden.volumes.unregister(
            "operation-delay",
          );
        });
      }
    });

    test("round-trips binary filesystem data across renderer IPC", async () => {
      const host = getHost();

      const result = await host.electronApp?.evaluate(
        async ({ webContents }, appId) => {
          const contents = webContents
            .getAllWebContents()
            .find((candidate) => candidate.getURL().includes(appId));
          if (!contents) throw new Error("Integration app view not found");
          return contents.executeJavaScript(`(async () => {
            const content = new Uint8Array([0, 255, 128, 1, 0]);
            await window.edenAPI.shellCommand("fs/write-binary", { location: { volume: "home", path: "/renderer-output.bin" }, content });
            const result = await window.edenAPI.shellCommand("fs/read-binary", { location: { volume: "home", path: "/renderer-output.bin" } });
            return {
              bytes: [...result],
              isUint8Array: result instanceof Uint8Array,
            };
          })()`);
        },
        APP_ID,
      );

      expect(result).toEqual({
        bytes: [0, 255, 128, 1, 0],
        isUint8Array: true,
      });
      await expect(
        fs.readFile(path.join(host.root, "users", "renderer-output.bin")),
      ).resolves.toEqual(Buffer.from([0, 255, 128, 1, 0]));
    });

    test("delivers native filesystem changes across preload IPC and stops after unwatch", async () => {
      const host = getHost();

      const watchId = await host.electronApp?.evaluate(
        async ({ webContents }, appId) => {
          const contents = webContents
            .getAllWebContents()
            .find((candidate) => candidate.getURL().includes(appId));
          if (!contents) throw new Error("Integration app view not found");
          return contents.executeJavaScript(`(async () => {
            globalThis.__fsChanges = [];
            await window.edenAPI.subscribe("fs/changed", (event) => globalThis.__fsChanges.push(event));
            return (await window.edenAPI.shellCommand("fs/watch", { location: { volume: "home", path: "/" } })).watchId;
          })()`);
        },
        APP_ID,
      );
      expect(watchId).toEqual(expect.any(String));

      await fs.writeFile(
        path.join(host.root, "users", "external.txt"),
        "changed",
      );
      await expect
        .poll(() =>
          host.electronApp?.evaluate(
            async ({ webContents }, { appId, watchId: expectedWatchId }) => {
              const contents = webContents
                .getAllWebContents()
                .find((candidate) => candidate.getURL().includes(appId));
              return contents?.executeJavaScript(
                `globalThis.__fsChanges?.some((event) => event.watchId === ${JSON.stringify(expectedWatchId)} && event.kind === "change")`,
              );
            },
            { appId: APP_ID, watchId },
          ),
        )
        .toBe(true);

      const controlWatchId = await host.evaluateApp(
        APP_ID,
        `(async () => {
        return (await window.edenAPI.shellCommand("fs/watch", { location: { volume: "home", path: "/" } })).watchId;
      })()`,
      );
      await host.electronApp?.evaluate(
        async ({ webContents }, { appId, watchId: activeWatchId }) => {
          const contents = webContents
            .getAllWebContents()
            .find((candidate) => candidate.getURL().includes(appId));
          await contents?.executeJavaScript(
            `window.edenAPI.shellCommand("fs/unwatch", { watchId: ${JSON.stringify(activeWatchId)} })`,
          );
        },
        { appId: APP_ID, watchId },
      );
      await host.evaluateApp(APP_ID, "globalThis.__fsChanges = []");
      try {
        await fs.writeFile(
          path.join(host.root, "users", "after-unwatch.txt"),
          "still observed",
        );
        await expect
          .poll(() =>
            host.evaluateApp(
              APP_ID,
              `globalThis.__fsChanges.some(event => event.watchId === ${JSON.stringify(controlWatchId)} && event.kind === "change")`,
            ),
          )
          .toBe(true);
        // Allow native watcher callbacks queued after the control event to arrive.
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(
          await host.evaluateApp(
            APP_ID,
            `globalThis.__fsChanges.filter(event => event.watchId === ${JSON.stringify(watchId)})`,
          ),
        ).toEqual([]);
      } finally {
        await host.evaluateApp(
          APP_ID,
          `window.edenAPI.shellCommand("fs/unwatch", { watchId: ${JSON.stringify(controlWatchId)} })`,
        );
      }
    });
  });
