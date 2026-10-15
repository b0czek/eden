import * as fs from "node:fs/promises";
import * as path from "node:path";
import { expect, test } from "@playwright/test";
import { useElectronHost } from "../../../../../tests/electron/support/host.js";

test.describe
  .serial("Files drive actions", () => {
    const getHost = useElectronHost({
      apps: ["com.eden.files", "com.eden.context-menu", "com.eden.toaster"],
    });

    test("Files opens drive actions by touch and permits retry after a busy device", async () => {
      const host = getHost();

      const appId = "com.eden.files";
      const running = await host.executeHostCommand<
        { manifest: { id: string } }[]
      >("process/list", {});
      if (
        !running.some(
          (process) => process.manifest.id === "com.eden.context-menu",
        )
      )
        await host.executeHostCommand("process/launch", {
          appId: "com.eden.context-menu",
        });
      const toasterRunning = await host.electronApp?.evaluate(
        ({ webContents }) =>
          webContents
            .getAllWebContents()
            .some((candidate) =>
              candidate.getURL().includes("com.eden.toaster"),
            ),
      );
      if (!toasterRunning)
        await host.executeHostCommand("process/launch", {
          appId: "com.eden.toaster",
        });
      const volumeId = `ui-eject-${appId}`;
      const driveRoot = path.join(host.root, volumeId);
      await fs.mkdir(driveRoot);
      await fs.writeFile(path.join(driveRoot, "before.txt"), "before");

      const evaluateMenu = (script: string) =>
        host.electronApp?.evaluate(async ({ webContents }, script) => {
          const contents = webContents
            .getAllWebContents()
            .find((candidate) =>
              candidate.getURL().includes("com.eden.context-menu"),
            );
          return contents?.executeJavaScript(script);
        }, script);
      const openVolumeMenu = async (
        inputMethod: "touch" | "context-menu" = "touch",
      ) => {
        if (inputMethod === "touch") {
          const page = host.electronApp
            ?.context()
            .pages()
            .find((candidate) => candidate.url().includes(appId));
          if (!page || !host.electronApp)
            throw new Error("Files page unavailable");
          await host.electronApp.evaluate(({ webContents }, appId) => {
            webContents
              .getAllWebContents()
              .find((contents) => contents.getURL().includes(appId))
              ?.focus();
          }, appId);
          const button = page.locator(
            `[data-volume="${volumeId}"] button[aria-haspopup="menu"]`,
          );
          // Resizing animates the sidebar; wait for a stable touch target.
          await button.click({ trial: true });
          const point = await button.evaluate((button) => {
            const bounds = button.getBoundingClientRect();
            return {
              x: bounds.left + bounds.width / 2,
              y: bounds.top + bounds.height / 2,
            };
          });
          const session = await host.electronApp.context().newCDPSession(page);
          try {
            await session.send("Input.dispatchTouchEvent", {
              type: "touchStart",
              touchPoints: [point],
            });
            await session.send("Input.dispatchTouchEvent", {
              type: "touchEnd",
              touchPoints: [],
            });
          } finally {
            await session.detach();
          }
        } else {
          await host.electronApp?.evaluate(
            async ({ webContents }, volumeId) => {
              const contents = webContents
                .getAllWebContents()
                .find((candidate) =>
                  candidate.getURL().includes("com.eden.files"),
                );
              if (!contents) throw new Error("Files is not running");
              const point = await contents.executeJavaScript(`(() => {
            const bounds = document.querySelector('[data-volume="${volumeId}"] button[aria-haspopup="menu"]').getBoundingClientRect();
            return { x: Math.round(bounds.left + bounds.width / 2), y: Math.round(bounds.top + bounds.height / 2) };
          })()`);
              contents.focus();
              contents.sendInputEvent({
                type: "mouseDown",
                button: "right",
                ...point,
              });
              contents.sendInputEvent({
                type: "mouseUp",
                button: "right",
                ...point,
              });
            },
            volumeId,
          );
        }
        await expect
          .poll(() =>
            evaluateMenu(
              `document.querySelector('#context-menu-root.is-open #context-menu-title')?.textContent`,
            ),
          )
          .toBe("Toolbar USB");
      };
      await host.electronApp?.evaluate(
        async (_electron, input) => {
          const host = globalThis as typeof globalThis & {
            __uiEjectFinish?: (busy: boolean) => void;
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
          delete host.__uiEjectFinish;
          await host.__edenIntegration.eden.volumes.register(
            {
              id: input.volumeId,
              label: "Toolbar USB",
              kind: "removable",
              rootPath: input.driveRoot,
            },
            {
              eject: () =>
                new Promise<void>((resolve, reject) => {
                  host.__uiEjectFinish = (busy) =>
                    busy ? reject(new Error("Device busy")) : resolve();
                }),
            },
          );
        },
        { volumeId, driveRoot },
      );
      await host.executeHostCommand("file/open", {
        location: { volume: volumeId, path: "/" },
      });
      await expect
        .poll(() =>
          host.evaluateApp(
            appId,
            `document.querySelector('.files-places [aria-current="location"]')?.closest('[data-volume]')?.getAttribute('data-volume')`,
          ),
        )
        .toBe(volumeId);
      expect(
        await host.evaluateApp(
          appId,
          `document.querySelector('[aria-label="Safely remove drive"]') === null`,
        ),
      ).toBe(true);
      await openVolumeMenu();
      await expect
        .poll(() =>
          evaluateMenu(
            `document.querySelector('.context-menu-item:not(.context-menu-item-disabled)')?.textContent`,
          ),
        )
        .toContain("Safely remove drive");
      const filesPage = host.electronApp
        ?.context()
        .pages()
        .find((page) => page.url().includes("com.eden.files"));
      const menuPage = host.electronApp
        ?.context()
        .pages()
        .find((page) => page.url().includes("com.eden.context-menu"));
      await filesPage?.screenshot({
        path: test.info().outputPath("files-places.png"),
      });
      await menuPage?.screenshot({
        path: test.info().outputPath("files-volume-menu.png"),
      });
      if (!filesPage || !host.electronApp)
        throw new Error("Files page unavailable");
      await evaluateMenu(
        `document.querySelector('#context-menu-overlay').click()`,
      );
      const originalBounds = await host.electronApp.evaluate(
        ({ BrowserWindow }, appId) => {
          const view = BrowserWindow.getAllWindows()
            .flatMap((window) => window.contentView.children)
            .find(
              (view) =>
                "webContents" in view &&
                (view as import("electron").WebContentsView).webContents
                  .getURL()
                  .includes(appId),
            );
          if (!view) throw new Error("Files view unavailable");
          return view.getBounds();
        },
        appId,
      );
      try {
        await host.executeHostCommand("view/update-view-bounds", {
          appId,
          bounds: { ...originalBounds, width: 600, height: 520 },
        });
        await expect.poll(() => filesPage.evaluate(() => innerWidth)).toBe(600);
        const driveActions = filesPage.locator(
          `[data-volume="${volumeId}"] button[aria-haspopup="menu"]`,
        );
        await expect(driveActions).toBeVisible();
        await expect(driveActions).toBeEnabled();
        await expect(driveActions).toHaveAccessibleName(/.+/);
        expect(
          await driveActions.evaluate((button) => {
            const bounds = button.getBoundingClientRect();
            const hit = document.elementFromPoint(
              bounds.left + bounds.width / 2,
              bounds.top + bounds.height / 2,
            );
            return hit !== null && button.contains(hit);
          }),
        ).toBe(true);
        for (const selector of [
          ".omnibox-container",
          ".toolbar-left",
          ".toolbar-right",
          ".explorer-content",
        ]) {
          const region = filesPage.locator(selector);
          await expect(region).toBeVisible();
          expect(
            await region.evaluate((element) => {
              const bounds = element.getBoundingClientRect();
              const main = element
                .closest(".files-main")
                ?.getBoundingClientRect();
              return (
                main !== undefined &&
                bounds.width > 0 &&
                bounds.height > 0 &&
                bounds.left >= main.left &&
                bounds.right <= main.right &&
                bounds.left >= 0 &&
                bounds.right <= window.innerWidth &&
                bounds.top >= 0 &&
                bounds.bottom <= window.innerHeight
              );
            }),
          ).toBe(true);
        }
        await filesPage.screenshot({
          path: test.info().outputPath("files-places-narrow.png"),
        });
        await openVolumeMenu();
      } finally {
        await host.executeHostCommand("view/update-view-bounds", {
          appId,
          bounds: originalBounds,
        });
      }
      await evaluateMenu(
        `document.querySelector('.context-menu-item').click()`,
      );
      await expect
        .poll(() =>
          host.evaluateApp(
            appId,
            `document.querySelector('[data-volume="${volumeId}"]')?.getAttribute('aria-busy')`,
          ),
        )
        .toBe("true");
      await openVolumeMenu("context-menu");
      await expect
        .poll(() =>
          evaluateMenu(
            `document.querySelector('.context-menu-item-disabled')?.textContent`,
          ),
        )
        .toContain("Removing drive");
      await evaluateMenu(
        `document.querySelector('#context-menu-overlay').click()`,
      );
      await expect
        .poll(() =>
          host.executeHostCommand<{ id: string; state: string }[]>(
            "volume/list",
            {},
          ),
        )
        .toContainEqual(
          expect.objectContaining({ id: volumeId, state: "ejecting" }),
        );
      await expect
        .poll(() =>
          host.electronApp?.evaluate(
            () =>
              typeof (
                globalThis as typeof globalThis & {
                  __uiEjectFinish?: unknown;
                }
              ).__uiEjectFinish,
          ),
        )
        .toBe("function");
      await host.electronApp?.evaluate(() => {
        (
          globalThis as typeof globalThis & {
            __uiEjectFinish: (busy: boolean) => void;
          }
        ).__uiEjectFinish(true);
      });
      await expect
        .poll(() => host.evaluateApp(appId, `document.body.textContent`))
        .toContain("Device busy");
      await host.evaluateApp(
        appId,
        `Array.from(document.querySelectorAll('button')).find((button) => button.textContent.trim() === 'OK')?.click()`,
      );
      await expect
        .poll(() =>
          host.evaluateApp(
            appId,
            `document.querySelector('[data-volume="${volumeId}"]')?.getAttribute('aria-busy')`,
          ),
        )
        .toBe("false");
      await fs.writeFile(path.join(driveRoot, "after-busy.txt"), "after");
      await expect
        .poll(() =>
          host.evaluateApp(
            appId,
            `document.querySelector('.file-list')?.textContent ?? document.body.textContent`,
          ),
        )
        .toContain("after-busy.txt");
      await host.evaluateApp(
        appId,
        `document.querySelector('[data-volume="home"] .eden-sidebar-item').click()`,
      );
      await expect
        .poll(() =>
          host.evaluateApp(
            appId,
            `document.querySelector('.files-places [aria-current="location"]')?.getAttribute('aria-label')`,
          ),
        )
        .toBe("Home");
      await host.electronApp?.evaluate(() => {
        delete (globalThis as typeof globalThis & { __uiEjectFinish?: unknown })
          .__uiEjectFinish;
      });
      await openVolumeMenu();
      await expect
        .poll(() =>
          evaluateMenu(
            `document.querySelector('.context-menu-item:not(.context-menu-item-disabled)')?.textContent`,
          ),
        )
        .toContain("Safely remove drive");
      await evaluateMenu(
        `document.querySelector('.context-menu-item').click()`,
      );
      await expect
        .poll(() =>
          host.executeHostCommand<{ id: string; state: string }[]>(
            "volume/list",
            {},
          ),
        )
        .toContainEqual(
          expect.objectContaining({ id: volumeId, state: "ejecting" }),
        );
      await expect
        .poll(() =>
          host.electronApp?.evaluate(
            () =>
              typeof (
                globalThis as typeof globalThis & {
                  __uiEjectFinish?: unknown;
                }
              ).__uiEjectFinish,
          ),
        )
        .toBe("function");
      await host.electronApp?.evaluate(() => {
        (
          globalThis as typeof globalThis & {
            __uiEjectFinish: (busy: boolean) => void;
          }
        ).__uiEjectFinish(false);
      });
      await expect
        .poll(() =>
          host.evaluateApp(
            appId,
            `document.querySelector('.files-places [aria-current="location"]')?.closest('[data-volume]')?.getAttribute('data-volume')`,
          ),
        )
        .toBe("home");
      expect(
        await host.executeHostCommand<{ id: string }[]>("volume/list", {}),
      ).not.toContainEqual(expect.objectContaining({ id: volumeId }));
      await host.executeHostCommand("process/stop", { appId });
    });
  });
