import * as fs from "node:fs/promises";
import * as path from "node:path";
import { expect, test } from "@playwright/test";
import { type ElectronHost, useElectronHost } from "./support/host";
import { APP_ID } from "./support/profile";

async function pauseScopeQuery(
  host: ElectronHost,
  appId: string,
  volume: string,
) {
  const app = host.electronApp;
  if (!app) throw new Error("Electron app is not running");
  await app.evaluate(
    (_electron, target) => {
      const integration = globalThis as typeof globalThis & {
        __edenIntegration: {
          eden: {
            runtime: {
              ipcBridge: {
                commandRegistry: {
                  execute(
                    command: string,
                    args: { volume?: string },
                    caller?: { appId?: string },
                    submission?: unknown,
                  ): Promise<unknown>;
                };
              };
            };
          };
        };
        __scopeQuery?: { pending: boolean; release(): void };
      };
      const registry =
        integration.__edenIntegration.eden.runtime.ipcBridge.commandRegistry;
      const execute = registry.execute;
      let release = () => {};
      const resumed = new Promise<void>((resolve) => {
        release = resolve;
      });
      const state = {
        pending: false,
        release: () => {
          registry.execute = execute;
          release();
        },
      };
      integration.__scopeQuery = state;
      registry.execute = async (command, args, caller, submission) => {
        if (
          command === "fs/access-scope" &&
          args.volume === target.volume &&
          caller?.appId === target.appId
        ) {
          registry.execute = execute;
          state.pending = true;
          await resumed;
        }
        return execute.call(registry, command, args, caller, submission);
      };
    },
    { appId, volume },
  );
  return {
    waitUntilPending: () =>
      expect
        .poll(() =>
          app.evaluate(
            () =>
              (
                globalThis as typeof globalThis & {
                  __scopeQuery?: { pending: boolean };
                }
              ).__scopeQuery?.pending,
          ),
        )
        .toBe(true),
    release: () =>
      app.evaluate(() => {
        (
          globalThis as typeof globalThis & {
            __scopeQuery?: { release(): void };
          }
        ).__scopeQuery?.release();
      }),
  };
}

test.describe
  .serial("browser through Electron", () => {
    const getHost = useElectronHost();
    test("browses and picks a registered drive, then returns Home on unplug", async () => {
      const host = getHost();

      const running = await host.executeHostCommand<
        { manifest: { id: string } }[]
      >("process/list", {});
      if (!running.some((process) => process.manifest.id === APP_ID))
        await host.executeHostCommand("process/launch", { appId: APP_ID });
      const driveRoot = path.join(host.root, "thumb-drive");
      await fs.mkdir(driveRoot);
      await fs.writeFile(path.join(driveRoot, "usb-report.txt"), "USB report");
      await host.electronApp?.evaluate(async (_electron, rootPath) => {
        const integration = globalThis as typeof globalThis & {
          __edenIntegration: {
            eden: {
              volumes: {
                register(
                  input: unknown,
                  options: { eject: () => Promise<void> },
                ): Promise<unknown>;
              };
            };
          };
        };
        await integration.__edenIntegration.eden.volumes.register(
          {
            id: "test-usb",
            label: "Test USB",
            kind: "removable",
            rootPath,
          },
          { eject: async () => undefined },
        );
      }, driveRoot);
      await expect(
        host.executeHostCommand("file/open", {
          location: { volume: "test-usb", path: "/" },
        }),
      ).resolves.toMatchObject({ success: true, appId: "com.eden.files" });

      await expect
        .poll(() =>
          host.evaluateApp(
            "com.eden.files",
            `document.querySelector('.files-places [aria-current="location"]')?.closest('[data-volume]')?.getAttribute('data-volume')`,
          ),
        )
        .toBe("test-usb");
      await expect
        .poll(() =>
          host.evaluateApp(
            "com.eden.files",
            `document.querySelector('.omnibox-container')?.getBoundingClientRect().width`,
          ),
        )
        .toBeGreaterThan(100);
      await expect
        .poll(() =>
          host.evaluateApp(
            "com.eden.files",
            `document.querySelector('.file-list')?.textContent ?? document.body.textContent`,
          ),
        )
        .toContain("usb-report.txt");
      await host.evaluateApp(
        APP_ID,
        `(async () => {
        globalThis.__volumePickerResult = undefined;
        await window.edenAPI.subscribe('file-picker/closed', result => { globalThis.__volumePickerResult = result; });
        await window.edenAPI.shellCommand('file-picker/open', { mode: 'open', initialLocation: { volume: 'test-usb', path: '/' } });
      })()`,
      );
      await expect
        .poll(() =>
          host.evaluateApp(
            "com.eden.file-picker",
            `document.querySelector('.explorer-header select')?.value`,
          ),
        )
        .toBe("test-usb");
      await expect
        .poll(() =>
          host.evaluateApp(
            "com.eden.file-picker",
            `document.querySelector('.file-item')?.textContent`,
          ),
        )
        .toContain("usb-report.txt");
      expect(
        await host.evaluateApp(
          "com.eden.file-picker",
          `document.querySelector('[aria-label="Safely remove drive"]') === null`,
        ),
      ).toBe(true);
      await expect(
        host.evaluateApp(
          "com.eden.file-picker",
          `window.edenAPI.shellCommand("volume/eject", { volume: "test-usb" })`,
        ),
      ).rejects.toThrow("Permission denied: volume/eject");
      await host.evaluateApp(
        "com.eden.file-picker",
        `document.querySelector('.file-item-main').click()`,
      );
      await expect
        .poll(() =>
          host.evaluateApp(
            "com.eden.file-picker",
            `document.querySelector('.file-picker-actions .eden-btn-primary')?.disabled`,
          ),
        )
        .toBe(false);
      await host.evaluateApp(
        "com.eden.file-picker",
        `document.querySelector('.file-picker-actions .eden-btn-primary').click()`,
      );
      await expect
        .poll(() => host.evaluateApp(APP_ID, `globalThis.__volumePickerResult`))
        .toMatchObject({
          reason: "select",
          locations: [{ volume: "test-usb", path: "/usb-report.txt" }],
        });
      await host.electronApp?.evaluate(() => {
        const integration = globalThis as typeof globalThis & {
          __edenIntegration: {
            eden: { volumes: { unregister(id: string): boolean } };
          };
        };
        integration.__edenIntegration.eden.volumes.unregister("test-usb");
      });
      await expect
        .poll(() =>
          host.evaluateApp(
            "com.eden.files",
            `document.querySelector('.files-places [aria-current="location"]')?.closest('[data-volume]')?.getAttribute('data-volume')`,
          ),
        )
        .toBe("home");
      await expect
        .poll(() =>
          host.evaluateApp(
            "com.eden.files",
            `Array.from(document.querySelectorAll('.files-places [data-volume]')).map(row => row.getAttribute('data-volume'))`,
          ),
        )
        .toEqual(["home"]);
      await host.executeHostCommand("process/stop", {
        appId: "com.eden.files",
      });
      await host.executeHostCommand("process/stop", {
        appId: "com.eden.file-picker",
      });
    });

    test("restores a restricted picker's listing and watch after its drive reconnects", async () => {
      const host = getHost();

      const running = await host.executeHostCommand<
        { manifest: { id: string } }[]
      >("process/list", {});
      if (!running.some((process) => process.manifest.id === APP_ID))
        await host.executeHostCommand("process/launch", { appId: APP_ID });
      const driveRoot = path.join(host.root, "reconnect-drive");
      await fs.mkdir(driveRoot);
      await fs.writeFile(path.join(driveRoot, "before.txt"), "before");
      const setConnected = async (connected: boolean) => {
        await host.electronApp?.evaluate(
          async (_electron, input) => {
            const integration = globalThis as typeof globalThis & {
              __edenIntegration: {
                eden: {
                  volumes: {
                    register(input: unknown): Promise<unknown>;
                    unregister(id: string): boolean;
                  };
                };
              };
            };
            if (input.connected) {
              await integration.__edenIntegration.eden.volumes.register({
                id: "reconnect-usb",
                label: "Reconnect USB",
                kind: "removable",
                rootPath: input.driveRoot,
              });
            } else {
              integration.__edenIntegration.eden.volumes.unregister(
                "reconnect-usb",
              );
            }
          },
          { connected, driveRoot },
        );
      };

      const listing = () =>
        host.evaluateApp(
          "com.eden.file-picker",
          `document.querySelector('.file-list')?.textContent ?? ''`,
        );
      try {
        await expect
          .poll(() => host.evaluateApp(APP_ID, `typeof window.edenAPI`))
          .toBe("object");
        await setConnected(true);
        await host.evaluateApp(
          APP_ID,
          `window.edenAPI.shellCommand('file-picker/open', {
          mode: 'open', allowedVolumes: ['reconnect-usb'], initialLocation: { volume: 'reconnect-usb', path: '/' }
        })`,
        );
        await expect.poll(listing).toContain("before.txt");
        await setConnected(false);
        await expect.poll(listing).not.toContain("before.txt");
        await fs.writeFile(
          path.join(driveRoot, "reconnected.txt"),
          "reconnected",
        );
        await setConnected(true);
        await expect.poll(listing).toContain("reconnected.txt");
        // A native change after the snapshot proves the new watch is active.
        await fs.writeFile(path.join(driveRoot, "watched.txt"), "watched");
        await expect.poll(listing).toContain("watched.txt");
      } finally {
        await host.executeHostCommand("process/stop", {
          appId: "com.eden.file-picker",
        });
        await setConnected(false);
      }
    });

    for (const appId of ["com.eden.files", "com.eden.file-picker"]) {
      test(`${appId} resumes live updates after a failed eject`, async () => {
        const host = getHost();

        const running = await host.executeHostCommand<
          { manifest: { id: string } }[]
        >("process/list", {});
        if (!running.some((process) => process.manifest.id === APP_ID))
          await host.executeHostCommand("process/launch", { appId: APP_ID });
        const driveRoot = path.join(host.root, `failed-eject-${appId}`);
        await fs.mkdir(driveRoot);
        await fs.writeFile(path.join(driveRoot, "before.txt"), "before");
        await host.electronApp?.evaluate(async (_electron, rootPath) => {
          const integration = globalThis as typeof globalThis & {
            __edenIntegration: {
              eden: {
                volumes: {
                  register(
                    input: unknown,
                    options: { eject(): Promise<void> },
                  ): Promise<unknown>;
                };
              };
            };
            __rejectExplorerEject?: () => void;
          };
          await integration.__edenIntegration.eden.volumes.register(
            {
              id: "failed-eject-drive",
              label: "Busy drive",
              kind: "removable",
              rootPath,
            },
            {
              eject: () =>
                new Promise<void>((_resolve, reject) => {
                  integration.__rejectExplorerEject = () =>
                    reject(new Error("Device is busy"));
                }),
            },
          );
        }, driveRoot);

        const listing = () =>
          host.evaluateApp(
            appId,
            `document.querySelector('.file-list')?.textContent ?? ''`,
          );
        try {
          await expect
            .poll(() => host.evaluateApp(APP_ID, `typeof window.edenAPI`))
            .toBe("object");
          if (appId === "com.eden.files") {
            await expect(
              host.executeHostCommand("file/open", {
                location: { volume: "failed-eject-drive", path: "/" },
              }),
            ).resolves.toMatchObject({ success: true, appId });
          } else {
            await host.evaluateApp(
              APP_ID,
              `window.edenAPI.shellCommand('file-picker/open', {
              mode: 'open', allowedVolumes: ['failed-eject-drive'], initialLocation: { volume: 'failed-eject-drive', path: '/' }
            })`,
            );
          }
          await expect.poll(listing).toContain("before.txt");
          const removal = host.executeHostCommand("volume/eject", {
            volume: "failed-eject-drive",
          });
          const failure = expect(removal).rejects.toThrow("Device is busy");
          await expect
            .poll(() =>
              host.electronApp?.evaluate(
                () =>
                  typeof (
                    globalThis as typeof globalThis & {
                      __rejectExplorerEject?: () => void;
                    }
                  ).__rejectExplorerEject,
              ),
            )
            .toBe("function");
          await fs.writeFile(
            path.join(driveRoot, "during-eject.txt"),
            "during",
          );
          await host.electronApp?.evaluate(() =>
            (
              globalThis as typeof globalThis & {
                __rejectExplorerEject?: () => void;
              }
            ).__rejectExplorerEject?.(),
          );
          await failure;
          // Recovery reloads changes made while the native watch was closed.
          await expect.poll(listing).toContain("during-eject.txt");
          await fs.writeFile(path.join(driveRoot, "after-eject.txt"), "after");
          // A later native change proves the recreated watch delivers live updates.
          await expect.poll(listing).toContain("after-eject.txt");
        } finally {
          await host.electronApp?.evaluate(() => {
            const integration = globalThis as typeof globalThis & {
              __edenIntegration: {
                eden: { volumes: { unregister(id: string): boolean } };
              };
              __rejectExplorerEject?: () => void;
            };
            integration.__rejectExplorerEject?.();
            delete integration.__rejectExplorerEject;
            integration.__edenIntegration.eden.volumes.unregister(
              "failed-eject-drive",
            );
          });
          await host.executeHostCommand("process/stop", { appId });
        }
      });

      test(`${appId} watches the parent after recovering from a deleted directory`, async () => {
        const host = getHost();

        const running = await host.executeHostCommand<
          { manifest: { id: string } }[]
        >("process/list", {});
        if (!running.some((process) => process.manifest.id === APP_ID))
          await host.executeHostCommand("process/launch", { appId: APP_ID });
        const driveRoot = path.join(host.root, `recovery-${appId}`);
        const directory = path.join(driveRoot, "nested");
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(path.join(directory, "before.txt"), "before");
        await fs.writeFile(path.join(driveRoot, "parent.txt"), "parent");
        await host.electronApp?.evaluate(async (_electron, rootPath) => {
          const integration = globalThis as typeof globalThis & {
            __edenIntegration: {
              eden: { volumes: { register(input: unknown): Promise<unknown> } };
            };
          };
          await integration.__edenIntegration.eden.volumes.register({
            id: "recovery-drive",
            label: "Recovery drive",
            kind: "local",
            rootPath,
          });
        }, driveRoot);

        const listing = () =>
          host.evaluateApp(
            appId,
            `document.querySelector('.file-list')?.textContent ?? ''`,
          );
        try {
          if (appId === "com.eden.files") {
            await expect(
              host.executeHostCommand("file/open", {
                location: { volume: "recovery-drive", path: "/nested" },
              }),
            ).resolves.toMatchObject({ success: true, appId });
          } else {
            await host.evaluateApp(
              APP_ID,
              `window.edenAPI.shellCommand('file-picker/open', {
                mode: 'open', allowedVolumes: ['recovery-drive'],
                initialLocation: { volume: 'recovery-drive', path: '/nested' }
              })`,
            );
          }
          await expect.poll(listing).toContain("before.txt");
          await fs.rm(directory, { recursive: true });
          await expect.poll(listing).toContain("parent.txt");
          // Write after recovery's snapshot to verify the parent has a live watch.
          await fs.writeFile(
            path.join(driveRoot, "after-recovery.txt"),
            "after",
          );
          await expect.poll(listing).toContain("after-recovery.txt");
        } finally {
          await host.executeHostCommand("process/stop", { appId });
          await host.electronApp?.evaluate(() => {
            const integration = globalThis as typeof globalThis & {
              __edenIntegration: {
                eden: { volumes: { unregister(id: string): boolean } };
              };
            };
            integration.__edenIntegration.eden.volumes.unregister(
              "recovery-drive",
            );
          });
        }
      });
    }

    test("closes a picker unplugged during its initial scope query and accepts another request", async () => {
      const host = getHost();
      const app = host.electronApp;
      if (!app) throw new Error("Electron app is not running");
      const running = await host.executeHostCommand<
        { manifest: { id: string } }[]
      >("process/list", {});
      if (!running.some((process) => process.manifest.id === APP_ID))
        await host.launchFixture();
      const driveRoot = path.join(host.root, "initializing-drive");
      await fs.mkdir(driveRoot);
      await app.evaluate(async (_electron, rootPath) => {
        const integration = globalThis as typeof globalThis & {
          __edenIntegration: {
            eden: { volumes: { register(args: unknown): Promise<unknown> } };
          };
        };
        await integration.__edenIntegration.eden.volumes.register({
          id: "initializing-drive",
          label: "Initializing drive",
          kind: "removable",
          rootPath,
        });
      }, driveRoot);
      const scope = await pauseScopeQuery(
        host,
        "com.eden.file-picker",
        "initializing-drive",
      );
      try {
        await host.evaluateApp(
          APP_ID,
          `(async () => {
          globalThis.__initializingPickerResult = undefined;
          await window.edenAPI.subscribe('file-picker/closed', result => { globalThis.__initializingPickerResult = result; });
          await window.edenAPI.shellCommand('file-picker/open', {
            mode: 'open', allowedVolumes: ['initializing-drive'],
            initialLocation: { volume: 'initializing-drive', path: '/' }
          });
        })()`,
        );
        await scope.waitUntilPending();
        await app.evaluate(() => {
          const integration = globalThis as typeof globalThis & {
            __edenIntegration: {
              eden: { volumes: { unregister(id: string): boolean } };
            };
          };
          integration.__edenIntegration.eden.volumes.unregister(
            "initializing-drive",
          );
        });
        await scope.release();
        await expect
          .poll(() =>
            host.evaluateApp(APP_ID, "globalThis.__initializingPickerResult"),
          )
          .toMatchObject({ reason: "cancel" });
        await host.evaluateApp(
          APP_ID,
          `window.edenAPI.shellCommand('file-picker/open', { mode: 'open' })`,
        );
        await expect
          .poll(() =>
            host.evaluateApp("com.eden.file-picker", "window.innerWidth"),
          )
          .toBeGreaterThan(100);
        await expect
          .poll(() =>
            host.evaluateApp(
              "com.eden.file-picker",
              `document.querySelector('.omnibox-display')?.textContent`,
            ),
          )
          .toBe("/");
        await host.evaluateApp(
          APP_ID,
          `window.edenAPI.shellCommand('file-picker/close', {})`,
        );
      } finally {
        await scope.release();
        await host.executeHostCommand("process/stop", {
          appId: "com.eden.file-picker",
        });
      }
    });

    test("Files and File Picker initialize restricted Home despite an inventory event and keep shared paths", async () => {
      const host = getHost();

      const app = host.electronApp;
      if (!app) throw new Error("Electron app is not running");
      const directory = path.join(host.root, "users/projects/design");
      const driveRoot = path.join(host.root, "scope-usb");
      await fs.mkdir(directory, { recursive: true });
      await fs.mkdir(driveRoot);
      await fs.writeFile(path.join(directory, "notes.txt"), "project notes");
      await fs.writeFile(path.join(host.root, "users/notes.txt"), "root decoy");
      await fs.writeFile(
        path.join(driveRoot, "drive-notes.txt"),
        "drive notes",
      );

      await app.evaluate(async () => {
        const { eden } = (
          globalThis as typeof globalThis & {
            __edenIntegration: {
              eden: {
                users: { create(args: unknown): Promise<unknown> };
                sessions: {
                  login(username: string, password: string): Promise<unknown>;
                };
              };
            };
          }
        ).__edenIntegration;
        await eden.users.create({
          username: "designer",
          name: "Designer",
          password: "password",
          directoryRestriction: "projects/design",
        });
        await eden.sessions.login("designer", "password");
      });
      const scope = await pauseScopeQuery(host, "com.eden.files", "home");
      await host.executeHostCommand("process/launch", {
        appId: "com.eden.files",
      });
      await expect
        .poll(() =>
          app.windows().some((page) => page.url().includes("com.eden.files")),
        )
        .toBe(true);
      const files = app
        .windows()
        .find((page) => page.url().includes("com.eden.files"));
      if (!files) throw new Error("Files page unavailable");
      try {
        await scope.waitUntilPending();
        await app.evaluate(async (_electron, rootPath) => {
          const integration = globalThis as typeof globalThis & {
            __edenIntegration: {
              eden: { volumes: { register(args: unknown): Promise<unknown> } };
            };
          };
          await integration.__edenIntegration.eden.volumes.register({
            id: "initial-inventory",
            label: "Initial inventory",
            kind: "removable",
            rootPath,
          });
        }, driveRoot);
        await expect(
          files.locator('[data-volume="initial-inventory"]'),
        ).toBeVisible();
      } finally {
        await scope.release();
        await app.evaluate(() => {
          const integration = globalThis as typeof globalThis & {
            __edenIntegration: {
              eden: { volumes: { unregister(id: string): boolean } };
            };
          };
          integration.__edenIntegration.eden.volumes.unregister(
            "initial-inventory",
          );
        });
      }
      await expect(files.locator(".omnibox-display")).toHaveText(
        "/projects/design",
      );
      await expect(
        files.locator(".file-item").filter({ hasText: "notes.txt" }),
      ).toBeVisible();
      await expect(
        files.getByRole("button", { name: "Go Up", exact: true }),
      ).toBeDisabled();

      await files.evaluate(
        `window.edenAPI.shellCommand('file-picker/open', { mode: 'open' })`,
      );
      await expect
        .poll(() =>
          app
            .windows()
            .some((page) => page.url().includes("com.eden.file-picker")),
        )
        .toBe(true);
      const picker = app
        .windows()
        .find((page) => page.url().includes("com.eden.file-picker"));
      if (!picker) throw new Error("File Picker page unavailable");
      await expect(picker.locator(".omnibox-display")).toHaveText(
        "/projects/design",
      );
      await expect(
        picker.getByRole("button", { name: "Go Up", exact: true }),
      ).toBeDisabled();
      await files.evaluate(
        `window.edenAPI.shellCommand('file-picker/close', {})`,
      );

      await app.evaluate(async (_electron, rootPath) => {
        const { eden } = (
          globalThis as typeof globalThis & {
            __edenIntegration: {
              eden: { volumes: { register(args: unknown): Promise<unknown> } };
            };
          }
        ).__edenIntegration;
        await eden.volumes.register({
          id: "scope-usb",
          label: "Scope USB",
          kind: "removable",
          rootPath,
        });
      }, driveRoot);
      await host.executeHostCommand("file/open", {
        location: { volume: "scope-usb", path: "/" },
      });
      await expect(
        files.locator(".file-item").filter({ hasText: "drive-notes.txt" }),
      ).toBeVisible();
      await files.evaluate(`(async () => {
        await window.edenAPI.subscribe('file-picker/closed', result => { globalThis.__scopePickerResult = result; });
        await window.edenAPI.shellCommand('file-picker/open', {
          mode: 'open', initialLocation: { volume: 'scope-usb', path: '/' }
        });
      })()`);
      await expect(
        picker.locator(".file-item").filter({ hasText: "drive-notes.txt" }),
      ).toBeVisible();
      await app.evaluate(() => {
        (
          globalThis as typeof globalThis & {
            __edenIntegration: {
              eden: { volumes: { unregister(id: string): void } };
            };
          }
        ).__edenIntegration.eden.volumes.unregister("scope-usb");
      });
      for (const page of [files, picker]) {
        await expect(page.locator(".omnibox-display")).toHaveText(
          "/projects/design",
        );
        await expect(
          page.locator(".file-item").filter({ hasText: "notes.txt" }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Go Up", exact: true }),
        ).toBeDisabled();
      }
      await picker
        .locator(".file-item")
        .filter({ hasText: "notes.txt" })
        .click();
      await picker.locator(".file-picker-actions .eden-btn-primary").click();
      await expect
        .poll(() => files.evaluate("globalThis.__scopePickerResult"))
        .toMatchObject({
          locations: [{ volume: "home", path: "/projects/design/notes.txt" }],
        });
    });
  });
