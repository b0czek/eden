import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Eden } from "@edenapp/sdk";
import { expect, type Locator, test } from "@playwright/test";
import { pauseCommand } from "../../../../../tests/electron/support/commands.js";
import {
  type ElectronPage,
  useElectronHost,
} from "../../../../../tests/electron/support/host.js";

const appId = "com.eden.files";
const trashEntries = (page: ElectronPage) =>
  page.locator(".files-trash .file-item");

async function expectTrashPath(page: ElectronPage, path: string) {
  await page.locator(".omnibox-display").click();
  await expect(page.locator(".omnibox-input")).toHaveValue(path);
  await page.locator(".omnibox-input").press("Escape");
}

async function openTrashPath(page: ElectronPage, path: string) {
  await page.locator(".omnibox-display").click();
  await page.locator(".omnibox-input").fill(path);
  await expect(page.locator(".suggestion-item")).toHaveCount(0);
  await page.locator(".omnibox-input").press("Enter");
  await expect(page.locator(".files-trash")).toBeVisible();
}

async function selectTrashItem(row: Locator) {
  const checkbox = row.getByRole("checkbox");
  if (!(await checkbox.count()))
    await row.page().locator(".file-select-button").click();
  await checkbox.check();
}

async function restoreItem(page: ElectronPage, row: Locator) {
  await selectTrashItem(row);
  await page.getByRole("button", { name: "Restore", exact: true }).click();
}

async function trashItem(page: ElectronPage, name: string) {
  const item = page
    .locator(".file-item")
    .filter({ has: page.locator(".file-name", { hasText: name }) });
  await item.hover();
  await item.getByTitle("Move to Trash", { exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Move to Trash", exact: true })
    .click();
  await expect(item).toHaveCount(0);
}

test.describe("Files Trash", () => {
  const getHost = useElectronHost({ apps: [appId, "com.eden.context-menu"] });

  const emptyTrash = async (page: ElectronPage) => {
    await page
      .getByRole("button", { name: "Trash actions", exact: true })
      .click();
    await expect
      .poll(() =>
        getHost().evaluateApp(
          "com.eden.context-menu",
          `document.querySelector('#context-menu-root.is-open .context-menu-item:not([aria-disabled="true"])')?.textContent`,
        ),
      )
      .toBe("Empty Trash");
    await getHost().evaluateApp(
      "com.eden.context-menu",
      `document.querySelector('.context-menu-item').click()`,
    );
  };

  test.beforeEach(async () => {
    const menuRunning = await getHost().electronApp?.evaluate(
      ({ webContents }) =>
        webContents
          .getAllWebContents()
          .some((contents) =>
            contents.getURL().includes("com.eden.context-menu"),
          ),
    );
    if (!menuRunning)
      await getHost().executeHostCommand("process/launch", {
        appId: "com.eden.context-menu",
      });
    const root = getHost().userDirectory;
    await fs.rm(path.join(root, ".eden-trash"), {
      recursive: true,
      force: true,
    });
    await fs.rm(path.join(root, "Scenarios"), { recursive: true, force: true });
    await fs.mkdir(path.join(root, "Scenarios"), { recursive: true });
  });

  test.afterEach(async () => {
    await getHost().executeHostCommand("process/stop", { appId });
  });

  test("keeps the same top bar and address control across folders and Trash at mouse and touch sizes", async () => {
    const host = getHost();
    const page = await host.launchApp(appId);
    await page
      .locator(".file-item")
      .filter({ hasText: "Scenarios" })
      .dblclick();
    const header = page.locator(".explorer-header");
    const original = await header.elementHandle();
    if (!original) throw new Error("File browser top bar is missing");
    const geometry = () =>
      header.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const address = element.querySelector(".omnibox-display");
        if (!address) throw new Error("Shared address control is missing");
        const style = getComputedStyle(address);
        return {
          width: bounds.width,
          height: bounds.height,
          buttons: [...element.querySelectorAll("button")].map((button) => {
            const bounds = button.getBoundingClientRect();
            return [bounds.width, bounds.height];
          }),
          address: [
            address.getBoundingClientRect().height,
            style.fontSize,
            style.padding,
            style.borderRadius,
          ],
        };
      });
    const session = await page.context().newCDPSession(page);
    try {
      for (const touch of [false, true]) {
        await session.send("Emulation.setTouchEmulationEnabled", {
          enabled: touch,
          maxTouchPoints: 5,
        });
        for (const width of [900, 600]) {
          await host.executeHostCommand("view/update-view-bounds", {
            appId,
            bounds: { x: 0, y: 0, width, height: 600 },
          });
          await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
          await expect
            .poll(() =>
              page
                .locator(".files-places")
                .evaluate((el) => el.getBoundingClientRect().width),
            )
            .toBe(width === 600 ? 72 : 240);
          await page.evaluate(async () => {
            await Promise.all(
              document
                .getAnimations()
                .filter(
                  (animation) =>
                    animation.effect?.getComputedTiming().iterations !==
                    Infinity,
                )
                .map((animation) => animation.finished.catch(() => undefined)),
            );
          });
          const folderGeometry = await geometry();
          await page
            .getByRole("button", { name: "Trash", exact: true })
            .click();
          await expect(page.locator(".files-trash")).toBeVisible();
          await expect(header).toHaveCount(1);
          expect(
            await header.evaluate(
              (element, prior) => element === prior,
              original,
            ),
          ).toBe(true);
          expect(await geometry()).toEqual(folderGeometry);
          await page
            .getByRole("button", { name: "Edit path", exact: true })
            .click();
          await expect(page.getByRole("textbox")).toHaveValue("/Trash");
          await page.getByRole("textbox").press("Escape");
          await page
            .getByRole("button", { name: "Go Back", exact: true })
            .click();
          await expect(page.locator(".files-trash")).toHaveCount(0);
          expect(
            await header.evaluate(
              (element, prior) => element === prior,
              original,
            ),
          ).toBe(true);
        }
      }
    } finally {
      await session.detach();
      await original.dispose();
    }
  });

  test("uses the regular views and touch selection for bulk restore and confirmed deletion", async () => {
    const host = getHost();
    const docs = path.join(host.userDirectory, "Scenarios");
    for (const name of ["alpha.txt", "beta.txt"])
      await fs.writeFile(path.join(docs, name), `original ${name}`);
    const page = await host.launchApp(appId);
    await page
      .locator(".file-item")
      .filter({ hasText: "Scenarios" })
      .dblclick();
    await trashItem(page, "alpha.txt");
    await trashItem(page, "beta.txt");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const display = page.getByRole("dialog", {
      name: "Display Options",
      exact: true,
    });
    await display.getByRole("button", { name: "List", exact: true }).click();
    await display.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Trash", exact: true }).click();
    await expect(trashEntries(page)).toHaveCount(2);
    await expect(trashEntries(page).first()).toHaveClass(/list-view/);
    await host.executeHostCommand("view/update-view-bounds", {
      appId,
      bounds: { x: 0, y: 0, width: 600, height: 400 },
    });
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(600);
    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 5,
    });
    const tap = async (locator: Locator) => {
      await expect(locator).toBeVisible();
      await locator.scrollIntoViewIfNeeded();
      const bounds = await locator.boundingBox();
      if (!bounds) throw new Error("Touch target is unavailable");
      await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [
          { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
        ],
      });
      await session.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    };
    try {
      await tap(page.getByRole("button", { name: "Select", exact: true }));
      await tap(
        trashEntries(page)
          .filter({ hasText: "alpha.txt" })
          .locator(".file-item-main"),
      );
      await tap(
        trashEntries(page)
          .filter({ hasText: "beta.txt" })
          .locator(".file-item-main"),
      );
      await expect(page.getByText("2 selected", { exact: true })).toBeVisible();
      const restore = page.getByRole("button", {
        name: "Restore",
        exact: true,
      });
      const deletion = page.getByRole("button", {
        name: "Delete permanently",
        exact: true,
      });
      for (const target of [restore, deletion]) {
        await expect
          .poll(async () => (await target.boundingBox())?.width ?? 0)
          .toBeGreaterThanOrEqual(44);
        await expect
          .poll(async () => (await target.boundingBox())?.height ?? 0)
          .toBeGreaterThanOrEqual(44);
      }
      await expect
        .poll(() =>
          page
            .locator(".files-trash")
            .evaluate((el) => el.scrollWidth <= el.clientWidth),
        )
        .toBe(true);
      await fs.writeFile(
        path.join(docs, "alpha.txt"),
        "concurrent replacement",
      );
      await tap(restore);
      const error = page.getByRole("dialog");
      await expect(error).toHaveAccessibleName("Restore under another name");
      await tap(error.getByRole("button", { name: "Cancel", exact: true }));
      await expect(trashEntries(page)).toHaveCount(1);
      await expect(
        fs.readFile(path.join(docs, "alpha.txt"), "utf8"),
      ).resolves.toBe("concurrent replacement");
      await expect(
        fs.readFile(path.join(docs, "beta.txt"), "utf8"),
      ).resolves.toBe("original beta.txt");
      await fs.rm(path.join(docs, "alpha.txt"));
      await tap(restore);
      await expect(trashEntries(page)).toHaveCount(0);
      await expect(
        fs.readFile(path.join(docs, "alpha.txt"), "utf8"),
      ).resolves.toBe("original alpha.txt");
      await tap(page.getByRole("button", { name: "Go Back", exact: true }));
      await trashItem(page, "alpha.txt");
      await tap(page.getByRole("button", { name: "Trash", exact: true }));
      await tap(page.getByRole("button", { name: "Settings", exact: true }));
      await tap(display.getByRole("button", { name: "Grid", exact: true }));
      await tap(display.getByRole("button", { name: "Close", exact: true }));
      await expect(trashEntries(page)).not.toHaveClass(/list-view/);
      await tap(page.getByRole("button", { name: "Select", exact: true }));
      await tap(trashEntries(page).locator(".file-item-main"));
      await tap(deletion);
      await tap(
        page
          .getByRole("dialog")
          .getByRole("button", { name: "Cancel", exact: true }),
      );
      await expect(trashEntries(page)).toHaveCount(1);
      await tap(deletion);
      await tap(
        page
          .getByRole("dialog")
          .getByRole("button", { name: "Delete permanently", exact: true }),
      );
      await expect(trashEntries(page)).toHaveCount(0);
      await tap(page.getByRole("button", { name: "Go Back", exact: true }));
      await expect(
        page.locator(".file-item").filter({ hasText: "beta.txt" }),
      ).not.toHaveClass(/list-view/);
    } finally {
      await session.detach();
    }
  });

  test("shows only Home Trash while treating mounted-volume storage as ordinary files", async () => {
    const host = getHost();
    const drive = path.join(host.root, "cloned-drive");
    await fs.mkdir(drive);
    for (const [volume, root, original] of [
      ["home", host.userDirectory, "/Scenarios/same.txt"],
      ["clone", drive, "/same.txt"],
    ]) {
      const entry = path.join(root, ".eden-trash", "shared-id");
      await fs.mkdir(entry, { recursive: true });
      await fs.writeFile(path.join(entry, "content"), volume);
      await fs.writeFile(
        path.join(entry, "metadata.json"),
        JSON.stringify({
          name: "same.txt",
          original: { volume, path: original },
          deletedAt: new Date().toISOString(),
        }),
      );
    }
    await host.electronApp?.evaluate(async (_electron, rootPath) => {
      const { eden } = (
        globalThis as typeof globalThis & { __edenIntegration: { eden: Eden } }
      ).__edenIntegration;
      await eden.runPromise(
        eden.volumes.register({
          id: "clone",
          label: "Cloned drive",
          kind: "removable",
          rootPath,
        }),
      );
    }, drive);
    try {
      const page = await host.launchApp(appId);
      await page.locator('[data-volume="clone"] .eden-sidebar-item').click();
      await expect(
        page.locator('.file-item[data-file-path="/.eden-trash"]'),
      ).toBeVisible();
      await page.getByRole("button", { name: "Trash", exact: true }).click();
      await expect(trashEntries(page)).toHaveCount(1);
      await expect(trashEntries(page)).toHaveAttribute(
        "data-file-volume",
        "home",
      );

      // The address editor must navigate Home even after browsing a drive.
      await page.locator(".omnibox-display").click();
      await page.locator(".omnibox-input").fill("/Scenarios");
      await page.locator(".omnibox-input").press("Enter");
      await expect(page.locator(".files-trash")).toHaveCount(0);
      await expect(
        page.locator('[data-volume="home"] [aria-current]'),
      ).toHaveCount(1);
      await expect(page.locator(".omnibox-display")).toHaveText("/Scenarios");

      await page.getByRole("button", { name: "Trash", exact: true }).click();
      await restoreItem(page, trashEntries(page));
      await expect(trashEntries(page)).toHaveCount(0);
      await expect(
        fs.readFile(
          path.join(host.userDirectory, "Scenarios/same.txt"),
          "utf8",
        ),
      ).resolves.toBe("home");
      await expect(
        fs.readFile(
          path.join(drive, ".eden-trash", "shared-id", "content"),
          "utf8",
        ),
      ).resolves.toBe("clone");
      await expect(fs.stat(path.join(drive, "same.txt"))).rejects.toMatchObject(
        { code: "ENOENT" },
      );

      await page.locator('[data-volume="clone"] .eden-sidebar-item').click();
      await page
        .locator('.file-item[data-file-path="/.eden-trash"]')
        .dblclick();
      await expect(page.locator(".files-trash")).toHaveCount(0);
      await expect(
        page.locator('.file-item[data-file-path="/.eden-trash/shared-id"]'),
      ).toBeVisible();
    } finally {
      await host.electronApp?.evaluate((_electron) => {
        const { eden } = (
          globalThis as typeof globalThis & {
            __edenIntegration: { eden: Eden };
          }
        ).__edenIntegration;
        eden.volumes.unregister("clone");
      });
    }
  });

  for (const targetName of ["target.txt", "content"]) {
    test(`restores a relative symbolic link to ${targetName} after moving it to Trash`, async () => {
      const host = getHost();
      const docs = path.join(host.userDirectory, "Scenarios");
      await fs.writeFile(path.join(docs, targetName), "target contents");
      await fs.symlink(targetName, path.join(docs, "link.txt"));
      const page = await host.launchApp(appId);
      await page
        .locator(".file-item")
        .filter({ hasText: "Scenarios" })
        .dblclick();
      await trashItem(page, "link.txt");
      await page.getByRole("button", { name: "Trash", exact: true }).click();
      const entry = trashEntries(page);
      await expect(entry).toHaveCount(1);
      await expect(entry).toContainText("link.txt");
      await restoreItem(page, entry);
      await expect(entry).toHaveCount(0);
      await expect(fs.readlink(path.join(docs, "link.txt"))).resolves.toBe(
        targetName,
      );
      await expect(
        fs.readFile(path.join(docs, targetName), "utf8"),
      ).resolves.toBe("target contents");
    });
  }

  test("round-trips literal backslashes in file and folder names", async () => {
    test.skip(
      process.platform === "win32",
      "Windows filenames cannot contain backslashes",
    );
    const host = getHost();
    const docs = path.join(host.userDirectory, "Scenarios");
    await fs.mkdir(path.join(docs, "a"));
    await fs.writeFile(path.join(docs, "a", "b.txt"), "separate nested file");
    await fs.writeFile(path.join(docs, "a\\b.txt"), "literal backslash");
    await fs.mkdir(path.join(docs, "a\\.eden-trash"));
    await fs.writeFile(
      path.join(docs, "a\\.eden-trash", "child.txt"),
      "ordinary folder",
    );
    const page = await host.launchApp(appId);
    await page
      .locator(".file-item")
      .filter({ hasText: "Scenarios" })
      .dblclick();
    for (const name of ["a\\b.txt", "a\\.eden-trash"])
      await trashItem(page, name);
    await page.getByRole("button", { name: "Trash", exact: true }).click();
    const entries = trashEntries(page);
    await expect(entries).toHaveCount(2);
    for (const name of ["a\\b.txt", "a\\.eden-trash"]) {
      const row = entries.filter({ hasText: name });
      await expect(row).toHaveCount(1);
      await selectTrashItem(row);
    }
    await page.getByRole("button", { name: "Restore", exact: true }).click();
    await expect(entries).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(await fs.readFile(path.join(docs, "a\\b.txt"), "utf8")).toBe(
      "literal backslash",
    );
    expect(
      await fs.readFile(path.join(docs, "a\\.eden-trash", "child.txt"), "utf8"),
    ).toBe("ordinary folder");
    expect(await fs.readFile(path.join(docs, "a", "b.txt"), "utf8")).toBe(
      "separate nested file",
    );
  });

  for (const pending of ["refresh", "recovery"] as const) {
    test(`keeps Trash history when an older folder ${pending} finishes`, async () => {
      const host = getHost();
      const page = await host.launchApp(appId);
      await page
        .locator(".file-item")
        .filter({ hasText: "Scenarios" })
        .dblclick();
      await expect(
        page.getByRole("button", { name: "Edit path", exact: true }),
      ).toHaveText("/Scenarios");
      const notices: string[] = [];
      const capture = (message: { text(): string }) =>
        notices.push(message.text());
      host.electronApp?.on("console", capture);
      const paused = await pauseCommand(
        host,
        pending === "refresh" ? "fs/readdir" : "fs/stat",
        {
          appId,
          args: {
            location: {
              volume: "home",
              path: pending === "refresh" ? "/Scenarios" : "/",
            },
          },
        },
      );
      try {
        if (pending === "refresh") {
          await page
            .getByRole("button", { name: "Refresh", exact: true })
            .click();
        } else {
          await fs.rm(path.join(host.userDirectory, "Scenarios"), {
            recursive: true,
          });
        }
        await paused.waitUntilPending();
        if (pending === "recovery") {
          await page
            .getByRole("dialog")
            .getByRole("button", { name: "OK", exact: true })
            .click();
          await fs.mkdir(path.join(host.userDirectory, "Scenarios"));
        }
        await page.getByRole("button", { name: "Trash", exact: true }).click();
        await expect(page.locator(".files-trash")).toBeVisible();
        await paused.release();
        await paused.waitUntilCompleted();
        // Let the delivered IPC response and its renderer continuations settle.
        await page.evaluate(
          () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
        );
        await page
          .getByRole("button", { name: "Go Back", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: "Edit path", exact: true }),
        ).toHaveText("/Scenarios");
        await page
          .getByRole("button", { name: "Go Forward", exact: true })
          .click();
        await expect(page.locator(".files-trash")).toBeVisible();
        await expectTrashPath(page, "/Trash");
        await expect(page.getByRole("dialog")).toHaveCount(0);
        expect(
          notices.filter((message) =>
            message.includes('Notification pushed: "Folder unavailable"'),
          ),
        ).toEqual([]);
      } finally {
        await paused.dispose();
        host.electronApp?.off("console", capture);
      }
    });
  }

  for (const action of ["restore", "delete"] as const) {
    test(`shows shared activity feedback during Trash ${action}`, async () => {
      const host = getHost();
      const docs = path.join(host.userDirectory, "Scenarios");
      await fs.writeFile(path.join(docs, "progress.txt"), "progress contents");
      const page = await host.launchApp(appId);
      await host.executeHostCommand("view/update-view-bounds", {
        appId,
        bounds: {
          x: 0,
          y: 0,
          width: action === "restore" ? 900 : 600,
          height: 600,
        },
      });
      await page
        .locator(".file-item")
        .filter({ hasText: "Scenarios" })
        .dblclick();
      await trashItem(page, "progress.txt");
      const [id] = await fs.readdir(
        path.join(host.userDirectory, ".eden-trash"),
      );
      const directory = { volume: "home", path: `/.eden-trash/${id}` };
      const paused = await pauseCommand(
        host,
        action === "restore" ? "fs/mv" : "fs/delete",
        {
          appId,
          args:
            action === "restore"
              ? { from: { ...directory, path: `${directory.path}/content` } }
              : { location: directory },
        },
      );
      try {
        await page.getByRole("button", { name: "Trash", exact: true }).click();
        await selectTrashItem(trashEntries(page));
        await page
          .getByRole("button", {
            name: action === "restore" ? "Restore" : "Delete permanently",
            exact: true,
          })
          .click();
        if (action === "delete")
          await page
            .getByRole("dialog")
            .getByRole("button", { name: "Delete permanently", exact: true })
            .click();
        await paused.waitUntilPending();
        const activity = page.getByRole("region", {
          name: "Activity",
          exact: true,
        });
        await expect(activity).toBeVisible();
        const label = `${action === "restore" ? "Restoring" : "Deleting"} 1 of 1: progress.txt`;
        if (action === "restore") {
          await expect(activity.getByRole("status")).toContainText(label);
          await expect(activity.locator(".eden-spinner").first()).toBeVisible();
        } else {
          await activity
            .getByRole("button", {
              name: `Operation details: ${label}`,
              exact: true,
            })
            .click();
          await expect(
            page.getByRole("dialog").getByRole("status"),
          ).toContainText(label);
          await expect(
            page.getByRole("dialog").locator(".eden-spinner"),
          ).toBeVisible();
        }
        await expect(page.locator(".files-trash")).toHaveAttribute(
          "aria-busy",
          "true",
        );
        await paused.release();
        await paused.waitUntilCompleted();
        await expect(trashEntries(page)).toHaveCount(0);
        await expect(activity).toHaveCount(0);
        if (action === "restore")
          expect(
            await fs.readFile(path.join(docs, "progress.txt"), "utf8"),
          ).toBe("progress contents");
      } finally {
        await paused.dispose();
      }
    });
  }

  test("ignores an old watch failure after a different Trash root has loaded", async () => {
    const host = getHost();
    const root = path.join(host.userDirectory, ".eden-trash");
    await fs.mkdir(root);
    await fs.writeFile(path.join(root, "not-a-directory"), "damaged entry");
    await fs.mkdir(path.join(host.userDirectory, "Scenarios", ".eden-trash"));
    const page = await host.launchApp(appId);
    const check = await pauseCommand(host, "fs/exists", {
      appId,
      args: {
        location: { volume: "home", path: "/.eden-trash/not-a-directory" },
      },
    });
    try {
      // A real non-directory entry fails watch admission, then checks existence.
      await page.getByRole("button", { name: "Trash", exact: true }).click();
      await check.waitUntilPending();
      await expect(page.getByRole("alert")).toContainText(
        "Some Trash items could not be loaded",
      );
      await page.getByRole("button", { name: "Home", exact: true }).click();
      await expect(page.locator(".files-trash")).toHaveCount(0);
      await openTrashPath(page, "/Scenarios/.eden-trash");
      await expect(
        page.getByText("Trash is empty", { exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("alert")).toHaveCount(0);
      await check.release();
      await check.waitUntilCompleted();
      await page.evaluate(
        () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
      );
      await expectTrashPath(page, "/Scenarios/Trash");
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(
        page.getByText("Trash is empty", { exact: true }),
      ).toBeVisible();
    } finally {
      await check.dispose();
    }
  });

  test("isolates damaged metadata and tracks external changes without manual refresh", async () => {
    const host = getHost();
    const docs = path.join(host.userDirectory, "Scenarios");
    for (const name of ["keep.txt", "damaged.txt"])
      await fs.writeFile(path.join(docs, name), name);
    const page = await host.launchApp(appId);
    await page
      .locator(".file-item")
      .filter({ hasText: "Scenarios" })
      .dblclick();
    await trashItem(page, "keep.txt");
    await trashItem(page, "damaged.txt");
    const root = path.join(host.userDirectory, ".eden-trash");
    let damaged = "";
    let metadata = "";
    for (const id of await fs.readdir(root)) {
      const candidate = await fs.readFile(
        path.join(root, id, "metadata.json"),
        "utf8",
      );
      if (JSON.parse(candidate).name === "damaged.txt") {
        damaged = id;
        metadata = candidate;
      }
    }
    expect(damaged).not.toBe("");
    await fs.writeFile(
      path.join(root, damaged, "metadata.json"),
      "invalid metadata",
    );
    await page.getByRole("button", { name: "Trash", exact: true }).click();
    const entries = trashEntries(page);
    await expect(page.getByRole("alert")).toContainText(
      "Some Trash items could not be loaded",
    );
    await expect(page.getByRole("alert")).toContainText(
      "The list may be incomplete",
    );
    await expect(entries).toHaveCount(1);
    await expect(entries).toContainText("keep.txt");
    await selectTrashItem(entries);
    await expect(
      page.getByRole("button", { name: "Restore", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await fs.writeFile(path.join(root, damaged, "metadata.json"), metadata);
    await expect(entries).toHaveCount(2);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await fs.rm(path.join(root, damaged), { recursive: true });
    await expect(entries).toHaveCount(1);

    const watch = await pauseCommand(host, "fs/watch", {
      appId,
      args: { location: { volume: "home", path: "/.eden-trash/external" } },
    });
    try {
      await fs.mkdir(path.join(root, "external"));
      await fs.writeFile(
        path.join(root, "external", "metadata.json"),
        JSON.stringify({
          original: { volume: "home", path: "/Scenarios/external.txt" },
          name: "external.txt",
          deletedAt: new Date().toISOString(),
        }),
      );
      await watch.waitUntilPending();
      await fs.writeFile(
        path.join(root, "external", "content"),
        "externally trashed",
      );
    } finally {
      await watch.dispose();
    }
    const external = entries.filter({ hasText: "external.txt" });
    await expect(external).toHaveCount(1);
    await restoreItem(page, external);
    await expect(external).toHaveCount(0);
    await expect(
      fs.readFile(path.join(docs, "external.txt"), "utf8"),
    ).resolves.toBe("externally trashed");
  });

  test("native Back and Forward include aggregate and folder-specific Trash destinations", async () => {
    const host = getHost();
    await fs.writeFile(
      path.join(host.userDirectory, "Scenarios", "notes.txt"),
      "notes",
    );
    const page = await host.launchApp(appId);
    await page
      .locator(".file-item")
      .filter({ hasText: "Scenarios" })
      .dblclick();
    await trashItem(page, "notes.txt");
    const session = await host.electronApp?.context().newCDPSession(page);
    if (!session) throw new Error("Electron page unavailable");
    const navigate = async (button: "back" | "forward") => {
      await session.send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: 350,
        y: 150,
        button,
        buttons: button === "back" ? 8 : 16,
        clickCount: 1,
      });
      await session.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: 350,
        y: 150,
        button,
        buttons: 0,
        clickCount: 1,
      });
    };
    try {
      await page.getByRole("button", { name: "Trash", exact: true }).click();
      await expect(page.locator(".files-trash")).toBeVisible();
      await navigate("back");
      await expect(
        page.getByRole("button", { name: "Edit path", exact: true }),
      ).toHaveText("/Scenarios");
      await navigate("forward");
      await expect(page.locator(".files-trash")).toBeVisible();
      await expect(trashEntries(page)).toHaveCount(1);
      await page.getByRole("button", { name: "Go Back", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Edit path", exact: true }),
      ).toHaveText("/Scenarios");
      await page.getByRole("button", { name: "Home", exact: true }).click();
      await expect(
        page.locator('.file-item[data-file-path="/.eden-trash"]'),
      ).toHaveCount(0);
      await openTrashPath(page, "/.eden-trash");
      await expectTrashPath(page, "/Trash");
      await navigate("back");
      await expect(
        page.getByRole("button", { name: "Edit path", exact: true }),
      ).toHaveText("/");
      await navigate("forward");
      await expectTrashPath(page, "/Trash");
    } finally {
      await session.detach();
    }
  });

  test("keeps same-name files across launches and restores their contents and missing parents", async () => {
    const host = getHost();
    for (const name of ["A", "B"]) {
      await fs.mkdir(path.join(host.userDirectory, "Scenarios", name));
      await fs.writeFile(
        path.join(host.userDirectory, "Scenarios", name, "notes.txt"),
        name,
      );
    }
    let page = await host.launchApp(appId);
    for (const name of ["A", "B"]) {
      await page.getByRole("button", { name: "Home", exact: true }).click();
      await page
        .locator(".file-item")
        .filter({ hasText: "Scenarios" })
        .dblclick();
      await page.locator(".file-item").filter({ hasText: name }).dblclick();
      await trashItem(page, "notes.txt");
    }
    await host.executeHostCommand("process/stop", { appId });
    await fs.rm(path.join(host.userDirectory, "Scenarios", "A"), {
      recursive: true,
    });
    page = await host.launchApp(appId);
    await page
      .getByRole("button", { name: "Collapse sidebar", exact: true })
      .click();
    const trash = page.getByRole("button", { name: "Trash", exact: true });
    await trash.click();
    await expect(trash).toHaveAttribute("aria-current", "location");
    await expect(page.locator("[data-volume=home] [aria-current]")).toHaveCount(
      0,
    );
    const entries = trashEntries(page);
    await expect(entries).toHaveCount(2);
    await host.executeHostCommand("view/update-view-bounds", {
      appId,
      bounds: { x: 0, y: 0, width: 600, height: 400 },
    });
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(600);
    await page
      .getByRole("button", { name: "Expand sidebar", exact: true })
      .click();
    await expect(page.locator(".files-trash")).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator(".files-trash")
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      )
      .toBe(true);
    for (const name of ["A", "B"]) {
      const row = entries.filter({ hasText: `/Scenarios/${name}` });
      await restoreItem(page, row);
      await expect(row).toHaveCount(0);
      await expect(
        fs.readFile(
          path.join(host.userDirectory, "Scenarios", name, "notes.txt"),
          "utf8",
        ),
      ).resolves.toBe(name);
    }
    await expect(
      page.getByText("Trash is empty", { exact: true }),
    ).toBeVisible();
    await expect(
      fs.readdir(path.join(host.userDirectory, ".eden-trash")),
    ).resolves.toEqual([]);
  });

  test("moves a selection of files and directories to Trash and confirms permanent deletion", async () => {
    const host = getHost();
    const root = path.join(host.userDirectory, "Scenarios");
    await fs.mkdir(path.join(root, "Folder"));
    await fs.writeFile(
      path.join(root, "Folder", "nested.txt"),
      "nested contents",
    );
    await fs.writeFile(path.join(root, "loose.txt"), "loose contents");
    const page = await host.launchApp(appId);
    await page
      .locator(".file-item")
      .filter({ hasText: "Scenarios" })
      .dblclick();
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await page.getByRole("button", { name: "Select All", exact: true }).click();
    await page
      .getByRole("button", { name: "Move to Trash", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Move to Trash", exact: true })
      .click();
    await expect(page.locator(".file-item")).toHaveCount(0);
    await page.getByRole("button", { name: "Trash", exact: true }).click();
    const entries = trashEntries(page);
    await expect(entries).toHaveCount(2);
    const folder = entries.filter({ hasText: "Folder" });
    await restoreItem(page, folder);
    await expect(folder).toHaveCount(0);
    await expect(
      fs.readFile(path.join(root, "Folder", "nested.txt"), "utf8"),
    ).resolves.toBe("nested contents");

    await emptyTrash(page);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await expect(entries).toHaveCount(1);
    await emptyTrash(page);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Empty Trash", exact: true })
      .click();
    await expect(entries).toHaveCount(0);
    await page
      .getByRole("button", { name: "Trash actions", exact: true })
      .click();
    await expect
      .poll(() =>
        host.evaluateApp(
          "com.eden.context-menu",
          `document.querySelector('#context-menu-root.is-open .context-menu-item')?.getAttribute('aria-disabled')`,
        ),
      )
      .toBe("true");
    await host.evaluateApp(
      "com.eden.context-menu",
      `document.querySelector('#context-menu-overlay').click()`,
    );
    await expect(
      fs.readdir(path.join(host.userDirectory, ".eden-trash")),
    ).resolves.toEqual([]);
    await expect(fs.readdir(root)).resolves.toEqual(["Folder"]);
  });

  test("preserves both versions when the original path is occupied", async () => {
    const host = getHost();
    const file = path.join(host.userDirectory, "Scenarios", "notes.txt");
    await fs.writeFile(file, "original contents");
    const page = await host.launchApp(appId);
    await page
      .locator(".file-item")
      .filter({ hasText: "Scenarios" })
      .dblclick();
    await trashItem(page, "notes.txt");
    await fs.writeFile(file, "replacement contents");
    await page.getByRole("button", { name: "Trash", exact: true }).click();
    const row = trashEntries(page);
    await restoreItem(page, row);
    const dialog = page.getByRole("dialog");
    await expect(dialog).toHaveAccessibleName("Restore under another name");
    await expect(dialog.getByRole("textbox")).toHaveValue("notes-restored.txt");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(row).toHaveCount(1);
    await restoreItem(page, row);
    await dialog.getByRole("textbox").fill("../escape.txt");
    await dialog.getByRole("button", { name: "Restore", exact: true }).click();
    await expect(dialog).toContainText("Invalid file or folder name");
    await dialog.getByRole("textbox").fill("notes.txt");
    await dialog.getByRole("button", { name: "Restore", exact: true }).click();
    await expect(dialog).toContainText("An item with this name already exists");
    await dialog.getByRole("textbox").fill("notes-restored.txt");
    await dialog.getByRole("button", { name: "Restore", exact: true }).click();
    await expect(row).toHaveCount(0);
    await expect(fs.readFile(file, "utf8")).resolves.toBe(
      "replacement contents",
    );
    await expect(
      fs.readFile(path.join(path.dirname(file), "notes-restored.txt"), "utf8"),
    ).resolves.toBe("original contents");
  });
});

test.describe("Files Trash with restricted Home and another volume", () => {
  const getHost = useElectronHost({ apps: [appId] });

  test("keeps Trash inside each account’s Home scope and deletes volume items permanently", async () => {
    const host = getHost();
    const scopedRoot = path.join(host.userDirectory, "Scoped");
    const driveRoot = path.join(host.root, "trash-drive");
    await fs.mkdir(scopedRoot);
    await fs.mkdir(path.join(host.userDirectory, "Second"));
    await fs.mkdir(driveRoot);
    await fs.writeFile(path.join(scopedRoot, "home.txt"), "home contents");
    await fs.writeFile(path.join(driveRoot, "drive.txt"), "drive contents");
    const app = host.electronApp;
    if (!app) throw new Error("Electron app is not running");
    await app.evaluate(async (_electron, rootPath) => {
      const { eden } = (
        globalThis as typeof globalThis & { __edenIntegration: { eden: Eden } }
      ).__edenIntegration;
      for (const [username, directoryRestriction] of [
        ["scoped", "Scoped"],
        ["second", "Second"],
      ]) {
        await eden.runPromise(
          eden.users.create({
            username,
            name: username,
            password: "password",
            directoryRestriction,
          }),
        );
      }
      await eden.runPromise(eden.sessions.login("scoped", "password"));
      await eden.runPromise(
        eden.volumes.register({
          id: "trash-drive",
          label: "Trash drive",
          kind: "removable",
          rootPath,
        }),
      );
    }, driveRoot);
    let page = await host.launchApp(appId);
    const item = page.locator(".file-item").filter({ hasText: "home.txt" });
    await item.locator(".file-item-main").click();
    await page.keyboard.press("Delete");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await expect(
      fs.readFile(path.join(scopedRoot, "home.txt"), "utf8"),
    ).resolves.toBe("home contents");
    await page.keyboard.press("Delete");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Move to Trash", exact: true })
      .click();
    await expect(item).toHaveCount(0);
    await page
      .locator('[data-volume="trash-drive"] .eden-sidebar-item')
      .click();
    const volumeFile = page
      .locator(".file-item")
      .filter({ hasText: "drive.txt" });
    await volumeFile.hover();
    await volumeFile.getByTitle("Delete permanently", { exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText(
      "This volume does not use Trash",
    );
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await expect(
      fs.readFile(path.join(driveRoot, "drive.txt"), "utf8"),
    ).resolves.toBe("drive contents");
    await volumeFile.hover();
    await volumeFile.getByTitle("Delete permanently", { exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete permanently", exact: true })
      .click();
    await expect(volumeFile).toHaveCount(0);
    await expect(
      fs.stat(path.join(driveRoot, ".eden-trash")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    await expect(
      fs.readdir(path.join(scopedRoot, ".eden-trash")),
    ).resolves.toHaveLength(1);
    await page.getByRole("button", { name: "Trash", exact: true }).click();
    await expectTrashPath(page, "/Scoped/Trash");
    await expect(trashEntries(page)).toHaveCount(1);
    await expect(trashEntries(page)).toContainText("home.txt");
    await expect(trashEntries(page)).toHaveAttribute(
      "data-file-volume",
      "home",
    );
    await host.executeHostCommand("process/stop", { appId });
    await app.evaluate(async () => {
      const { eden } = (
        globalThis as typeof globalThis & { __edenIntegration: { eden: Eden } }
      ).__edenIntegration;
      await eden.runPromise(eden.sessions.login("second", "password"));
    });
    page = await host.launchApp(appId);
    await page.getByRole("button", { name: "Trash", exact: true }).click();
    await expectTrashPath(page, "/Second/Trash");
    await expect(trashEntries(page)).toHaveCount(0);
    await expect(
      page.getByText("Trash is empty", { exact: true }),
    ).toBeVisible();
    await expect(
      fs.readdir(path.join(scopedRoot, ".eden-trash")),
    ).resolves.toHaveLength(1);
    await host.executeHostCommand("process/stop", { appId });
  });
});

test.describe("Files hidden Trash storage", () => {
  const getHost = useElectronHost({ apps: [appId] });

  test("hides nested Trash storage in grid and list views while keeping ordinary folders and hidden files visible", async () => {
    const host = getHost();
    await fs.mkdir(path.join(host.userDirectory, "Restricted"));
    await fs.mkdir(path.join(host.userDirectory, "Restricted", "Trash"));
    await fs.writeFile(
      path.join(host.userDirectory, "Restricted", ".hidden.txt"),
      "ordinary hidden file",
    );
    await fs.writeFile(
      path.join(host.userDirectory, "Restricted", "notes.txt"),
      "restricted contents",
    );
    const app = host.electronApp;
    if (!app) throw new Error("Electron app is not running");
    await app.evaluate(async () => {
      const { eden } = (
        globalThis as typeof globalThis & { __edenIntegration: { eden: Eden } }
      ).__edenIntegration;
      await eden.runPromise(
        eden.users.create({
          username: "restricted",
          name: "Restricted",
          password: "password",
          directoryRestriction: "Restricted",
        }),
      );
      await eden.runPromise(
        eden.users.create({
          username: "admin",
          name: "Admin",
          password: "password",
        }),
      );
      await eden.runPromise(eden.sessions.login("restricted", "password"));
    });
    let page = await host.launchApp(appId);
    await trashItem(page, "notes.txt");
    await host.executeHostCommand("process/stop", { appId });
    await app.evaluate(async () => {
      const { eden } = (
        globalThis as typeof globalThis & { __edenIntegration: { eden: Eden } }
      ).__edenIntegration;
      await eden.runPromise(eden.sessions.login("admin", "password"));
    });
    page = await host.launchApp(appId);
    await page.getByRole("button", { name: "Trash", exact: true }).click();
    await expect(
      page.getByText("Trash is empty", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await page
      .locator(".file-item")
      .filter({ hasText: "Restricted" })
      .dblclick();
    const storage = page.locator(
      '.file-item[data-file-path="/Restricted/.eden-trash"]',
    );
    await expect(storage).toHaveCount(0);
    await expect(page.locator(".file-item")).toHaveCount(2);
    await expect(
      page.locator('.file-item[data-file-path="/Restricted/Trash"] .file-name'),
    ).toHaveText("Trash");
    await expect(
      page.locator('.file-item[data-file-path="/Restricted/.hidden.txt"]'),
    ).toBeVisible();
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await page.keyboard.press("Control+a");
    await expect(page.getByText("2 selected", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const displayOptions = page.getByRole("dialog", {
      name: "Display Options",
      exact: true,
    });
    await displayOptions
      .getByRole("button", { name: "List", exact: true })
      .click();
    await displayOptions
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await expect(storage).toHaveCount(0);
    await expect(page.locator(".file-item.list-view")).toHaveCount(2);
    await host.executeHostCommand("settings/set/su", {
      appId: "com.eden",
      key: "general.locale",
      value: "pl",
    });
    await expect(
      page.getByRole("button", { name: "Kosz", exact: true }),
    ).toBeVisible();
    await expect(storage).toHaveCount(0);
    await expect(
      page.locator('.file-item[data-file-path="/Restricted/Trash"] .file-name'),
    ).toHaveText("Trash");
    await openTrashPath(page, "/Restricted/.eden-trash");
    await expectTrashPath(page, "/Restricted/Kosz");
    const entry = trashEntries(page);
    await expect(entry).toHaveCount(1);
    await host.executeHostCommand("view/update-view-bounds", {
      appId,
      bounds: { x: 0, y: 0, width: 600, height: 400 },
    });
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(600);
    await expect
      .poll(() =>
        page
          .locator(".files-trash")
          .evaluate(
            (element) =>
              element.scrollWidth <= element.clientWidth &&
              element.getBoundingClientRect().right <= innerWidth,
          ),
      )
      .toBe(true);
    await selectTrashItem(entry);
    await page.getByRole("button", { name: "Przywróć", exact: true }).click();
    await expect(entry).toHaveCount(0);
    await expect(
      fs.readFile(
        path.join(host.userDirectory, "Restricted", "notes.txt"),
        "utf8",
      ),
    ).resolves.toBe("restricted contents");
    await host.executeHostCommand("process/stop", { appId });
  });
});
