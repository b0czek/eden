import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Eden } from "@edenapp/sdk";
import { expect, type Locator, test } from "@playwright/test";
import { useElectronHost } from "../../../../../tests/electron/support/host.js";

const appId = "com.eden.files";
const menuId = "com.eden.context-menu";

test.describe("Files Trash context menus", () => {
  const getHost = useElectronHost({ apps: [appId, menuId] });
  const evaluateMenu = (script: string) =>
    getHost().evaluateApp(menuId, script);
  const menuItems = () =>
    evaluateMenu(
      `Array.from(document.querySelectorAll('#context-menu-root.is-open .context-menu-item')).map(item => ({label: item.textContent, disabled: item.getAttribute('aria-disabled') === 'true'}))`,
    );
  const choose = async (label: string) => {
    await expect.poll(menuItems).toContainEqual({ label, disabled: false });
    await evaluateMenu(
      `Array.from(document.querySelectorAll('.context-menu-item')).find(item => item.textContent === ${JSON.stringify(label)}).click()`,
    );
    await expect
      .poll(() =>
        evaluateMenu(
          `document.querySelector('#context-menu-root').classList.contains('is-open')`,
        ),
      )
      .toBe(false);
  };
  const dismiss = () =>
    evaluateMenu(`document.querySelector('#context-menu-overlay').click()`);
  const rightClick = async (target: Locator, background = false) => {
    const point = await target.evaluate((element, background) => {
      const bounds = element.getBoundingClientRect();
      return {
        x: Math.round(bounds.left + bounds.width / 2),
        y: Math.round(
          background ? bounds.bottom - 10 : bounds.top + bounds.height / 2,
        ),
      };
    }, background);
    await getHost().electronApp?.evaluate(({ webContents }, point) => {
      const contents = webContents
        .getAllWebContents()
        .find((candidate) => candidate.getURL().includes("com.eden.files"));
      if (!contents) throw new Error("Files is not running");
      contents.focus();
      contents.sendInputEvent({ type: "mouseDown", button: "right", ...point });
      contents.sendInputEvent({ type: "mouseUp", button: "right", ...point });
    }, point);
    await expect
      .poll(() =>
        evaluateMenu(
          `document.querySelector('#context-menu-root').classList.contains('is-open')`,
        ),
      )
      .toBe(true);
  };
  const seed = async (
    name: string,
    root = getHost().userDirectory,
    volume = "home",
  ) => {
    const entry = path.join(root, ".eden-trash", name);
    await fs.mkdir(entry, { recursive: true });
    await fs.writeFile(
      path.join(entry, "metadata.json"),
      JSON.stringify({
        original: { volume, path: `/Scenarios/${name}` },
        name,
        deletedAt: new Date().toISOString(),
      }),
    );
    await fs.writeFile(path.join(entry, "content"), `contents of ${name}`);
  };
  const launch = async () => {
    const page = await getHost().launchApp(appId);
    await page.getByRole("button", { name: "Trash", exact: true }).click();
    await expect(page.locator(".files-trash")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    return page;
  };

  test.beforeEach(async () => {
    const host = getHost();
    await fs.rm(path.join(host.userDirectory, ".eden-trash"), {
      recursive: true,
      force: true,
    });
    await fs.rm(path.join(host.userDirectory, "Scenarios"), {
      recursive: true,
      force: true,
    });
    await fs.mkdir(path.join(host.userDirectory, "Scenarios"));
    const menuRunning = await host.electronApp?.evaluate(({ webContents }) =>
      webContents
        .getAllWebContents()
        .some((contents) =>
          contents.getURL().includes("com.eden.context-menu"),
        ),
    );
    if (!menuRunning)
      await host.executeHostCommand("process/launch", { appId: menuId });
  });
  test.afterEach(async () => {
    await dismiss();
    await getHost().executeHostCommand("process/stop", { appId });
  });

  test("restores a right-clicked selection and targets an unselected item separately", async () => {
    for (const name of ["alpha.txt", "beta.txt", "gamma.txt"]) await seed(name);
    const page = await launch();
    const rows = page.locator(".files-trash .file-item");
    const row = (name: string) =>
      rows.filter({ has: page.locator(".file-name", { hasText: name }) });
    await expect(rows).toHaveCount(3);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await row("alpha.txt").locator(".file-item-main").click();
    await row("beta.txt").locator(".file-item-main").click();
    await rightClick(row("alpha.txt"));
    await expect
      .poll(() =>
        evaluateMenu(
          `document.querySelector('#context-menu-title').textContent`,
        ),
      )
      .toBe("2 selected");
    await expect(rows.locator("input:checked")).toHaveCount(2);
    await choose("Restore");
    await expect(rows).toHaveCount(1);
    for (const name of ["alpha.txt", "beta.txt"])
      await expect(
        fs.readFile(
          path.join(getHost().userDirectory, "Scenarios", name),
          "utf8",
        ),
      ).resolves.toBe(`contents of ${name}`);

    // A focused file must not be included when another item is targeted.
    await seed("delta.txt");
    await expect(rows).toHaveCount(2);
    await row("gamma.txt").locator(".file-item-main").click();
    await rightClick(row("delta.txt"));
    await expect(rows.locator("input:checked")).toHaveCount(0);
    await expect(
      page.locator(".files-trash .selection-action-bar"),
    ).toHaveCount(0);
    await choose("Delete permanently");
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(rows).toHaveCount(2);
    await rightClick(row("delta.txt"));
    await choose("Delete permanently");
    await dialog
      .getByRole("button", { name: "Delete permanently", exact: true })
      .click();
    await expect(row("delta.txt")).toHaveCount(0);
    await expect(row("gamma.txt")).toHaveCount(1);
    await expect(
      fs.readFile(
        path.join(
          getHost().userDirectory,
          ".eden-trash",
          "gamma.txt",
          "content",
        ),
        "utf8",
      ),
    ).resolves.toBe("contents of gamma.txt");
    await expect(
      fs.stat(path.join(getHost().userDirectory, ".eden-trash", "delta.txt")),
    ).rejects.toThrow();
  });

  test("shares item details between normal Files and Trash and restores from details", async () => {
    const host = getHost();
    const file = path.join(host.userDirectory, "Scenarios", "details.txt");
    await fs.writeFile(file, "details contents");
    const page = await host.launchApp(appId);
    await page
      .locator(".file-item")
      .filter({ hasText: "Scenarios" })
      .dblclick();
    const row = page.locator(".file-item").filter({ hasText: "details.txt" });
    await rightClick(row);
    await choose("Details");
    const dialog = page.getByRole("dialog", { name: "Details", exact: true });
    await expect(dialog.locator(".files-item-details")).toContainText(
      "/Scenarios/details.txt",
    );
    await expect(dialog).toContainText("16 B");
    await expect(
      dialog.getByRole("button", { name: "Restore", exact: true }),
    ).toHaveCount(0);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await row.hover();
    await row.getByTitle("Move to Trash", { exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Move to Trash", exact: true })
      .click();
    await page.getByRole("button", { name: "Trash", exact: true }).click();
    const trashed = page.locator(".files-trash .file-item");
    await rightClick(trashed);
    await choose("Details");
    await expect(dialog.locator(".files-item-details")).toContainText(
      "/Scenarios/details.txt",
    );
    await expect(dialog).toContainText("Original location");
    await expect(dialog).toContainText("Date deleted");
    await host.executeHostCommand("view/update-view-bounds", {
      appId,
      bounds: { x: 0, y: 0, width: 600, height: 400 },
    });
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(600);
    await expect
      .poll(() =>
        dialog.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      )
      .toBe(true);
    await dialog.getByRole("button", { name: "Restore", exact: true }).click();
    await expect(trashed).toHaveCount(0);
    await expect(fs.readFile(file, "utf8")).resolves.toBe("details contents");
    await expect(
      page.locator(".files-trash .selection-action-bar"),
    ).toHaveCount(0);
  });

  test("offers selection, refresh, and confirmed Empty Trash on the background", async () => {
    for (const name of ["alpha.txt", "beta.txt"]) await seed(name);
    const page = await launch();
    const rows = page.locator(".files-trash .file-item");
    const background = page.locator(".files-trash .explorer-content");
    await expect(rows).toHaveCount(2);
    await rightClick(background, true);
    await expect.poll(menuItems).toEqual([
      { label: "Select All", disabled: false },
      { label: "Refresh", disabled: false },
      { label: "Empty Trash", disabled: false },
    ]);
    await choose("Select All");
    await expect(rows.locator("input:checked")).toHaveCount(2);
    await rightClick(background, true);
    await choose("Refresh");
    await expect(rows).toHaveCount(2);
    await rightClick(background, true);
    await choose("Empty Trash");
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(rows).toHaveCount(2);
    await rightClick(background, true);
    await choose("Empty Trash");
    await dialog
      .getByRole("button", { name: "Empty Trash", exact: true })
      .click();
    await expect(rows).toHaveCount(0);
    await expect(
      fs.readdir(path.join(getHost().userDirectory, ".eden-trash")),
    ).resolves.toEqual([]);
    await rightClick(background, true);
    await expect.poll(menuItems).toEqual([
      { label: "Select All", disabled: true },
      { label: "Refresh", disabled: false },
      { label: "Empty Trash", disabled: true },
    ]);
  });

  test("focuses items without entering selection mode and runs single-item menu actions directly", async () => {
    for (const name of ["restore.txt", "delete.txt"]) await seed(name);
    const page = await launch();
    const rows = page.locator(".files-trash .file-item");
    const restore = rows.filter({ hasText: "restore.txt" });
    const deletion = rows.filter({ hasText: "delete.txt" });
    const expectBrowsing = async () => {
      await expect(rows.locator("input[type=checkbox]")).toHaveCount(0);
      await expect(
        page.locator(".files-trash .selection-action-bar"),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Select", exact: true }),
      ).toBeVisible();
    };
    await restore.locator(".file-item-main").click();
    await expectBrowsing();
    await restore.locator(".file-item-main").dblclick();
    const details = page.getByRole("dialog", { name: "Details", exact: true });
    await expect(details).toContainText("/Scenarios/restore.txt");
    await expectBrowsing();
    await details.getByRole("button", { name: "Close", exact: true }).click();
    await restore.locator(".file-item-main").press("Enter");
    await expect(details).toBeVisible();
    await expectBrowsing();
    await details.getByRole("button", { name: "Close", exact: true }).click();
    const session = await page.context().newCDPSession(page);
    try {
      await session.send("Emulation.setTouchEmulationEnabled", {
        enabled: true,
        maxTouchPoints: 5,
      });
      const point = await deletion
        .locator(".file-item-main")
        .evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return {
            x: bounds.left + bounds.width / 2,
            y: bounds.top + bounds.height / 2,
          };
        });
      await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [point],
      });
      await session.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await expect(details).toContainText("/Scenarios/delete.txt");
      await expectBrowsing();
      await details.getByRole("button", { name: "Close", exact: true }).click();
    } finally {
      await session.detach();
    }
    await rightClick(restore);
    await expectBrowsing();
    await dismiss();
    await expectBrowsing();
    await rightClick(restore);
    await choose("Restore");
    await expect(restore).toHaveCount(0);
    await expectBrowsing();
    await expect(
      fs.readFile(
        path.join(getHost().userDirectory, "Scenarios", "restore.txt"),
        "utf8",
      ),
    ).resolves.toBe("contents of restore.txt");
    await rightClick(deletion);
    await expectBrowsing();
    await choose("Delete permanently");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await expectBrowsing();
    await expect(deletion).toHaveCount(1);
    await rightClick(deletion);
    await choose("Delete permanently");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete permanently", exact: true })
      .click();
    await expect(rows).toHaveCount(0);
    await expectBrowsing();
    await expect(
      fs.stat(path.join(getHost().userDirectory, ".eden-trash", "delete.txt")),
    ).rejects.toThrow();
  });

  test("ignores mounted-volume entries in Trash menus and Empty Trash", async () => {
    const host = getHost();
    const drive = path.join(host.root, "readonly-trash-menu");
    await seed("locked.txt", drive, "readonly-trash-menu");
    await seed("writable.txt");
    await host.electronApp?.evaluate(async (_electron, rootPath) => {
      const { eden } = (
        globalThis as typeof globalThis & { __edenIntegration: { eden: Eden } }
      ).__edenIntegration;
      await eden.runPromise(
        eden.volumes.register({
          id: "readonly-trash-menu",
          label: "Read-only drive",
          kind: "removable",
          rootPath,
          readOnly: true,
        }),
      );
    }, drive);
    try {
      const page = await launch();
      const rows = page.locator(".files-trash .file-item");
      await expect(rows).toHaveCount(1);
      await expect(rows).toContainText("writable.txt");
      await rightClick(rows);
      await expect.poll(menuItems).toEqual([
        { label: "Restore", disabled: false },
        { label: "Details", disabled: false },
        { label: "Delete permanently", disabled: false },
      ]);
      await dismiss();
      await rightClick(page.locator(".files-trash .explorer-content"), true);
      await choose("Empty Trash");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Empty Trash", exact: true })
        .click();
      await expect(rows).toHaveCount(0);
      await expect(
        fs.readFile(
          path.join(drive, ".eden-trash", "locked.txt", "content"),
          "utf8",
        ),
      ).resolves.toBe("contents of locked.txt");
      await rightClick(page.locator(".files-trash .explorer-content"), true);
      await expect
        .poll(menuItems)
        .toContainEqual({ label: "Empty Trash", disabled: true });
    } finally {
      await host.electronApp?.evaluate(() => {
        (
          globalThis as typeof globalThis & {
            __edenIntegration: { eden: Eden };
          }
        ).__edenIntegration.eden.volumes.unregister("readonly-trash-menu");
      });
    }
  });

  test("empties only Home Trash from the sidebar without navigating and has no bottom bar", async () => {
    const host = getHost();
    const drive = path.join(host.root, "sidebar-trash-drive");
    await seed("home.txt");
    await seed("drive.txt", drive, "sidebar-trash-drive");
    await host.electronApp?.evaluate(async (_electron, rootPath) => {
      const { eden } = (
        globalThis as typeof globalThis & { __edenIntegration: { eden: Eden } }
      ).__edenIntegration;
      await eden.runPromise(
        eden.volumes.register({
          id: "sidebar-trash-drive",
          label: "Sidebar drive",
          kind: "removable",
          rootPath,
        }),
      );
    }, drive);
    try {
      const page = await host.launchApp(appId);
      const sidebarTrash = page.getByRole("button", {
        name: "Trash",
        exact: true,
      });
      await rightClick(sidebarTrash);
      await expect
        .poll(menuItems)
        .toEqual([{ label: "Empty Trash", disabled: false }]);
      await choose("Empty Trash");
      await expect(page.locator(".files-trash")).toHaveCount(0);
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      await expect(
        fs.readdir(path.join(host.userDirectory, ".eden-trash")),
      ).resolves.toHaveLength(1);

      // Opening storage by path uses the same Home Trash as the sidebar.
      await expect(
        page.locator('.file-item[data-file-path="/.eden-trash"]'),
      ).toHaveCount(0);
      await page.locator(".omnibox-display").click();
      await page.locator(".omnibox-input").fill("/.eden-trash");
      await expect(page.locator(".suggestion-item")).toHaveCount(0);
      await page.locator(".omnibox-input").press("Enter");
      await expect(page.locator(".files-trash .file-item")).toHaveCount(1);
      await expect(page.locator(".files-trash footer")).toHaveCount(0);
      const actions = page.getByRole("button", {
        name: "Trash actions",
        exact: true,
      });
      const session = await page.context().newCDPSession(page);
      try {
        await session.send("Emulation.setTouchEmulationEnabled", {
          enabled: true,
          maxTouchPoints: 5,
        });
        const point = await actions.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return {
            x: bounds.left + bounds.width / 2,
            y: bounds.top + bounds.height / 2,
          };
        });
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
      await choose("Empty Trash");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Empty Trash", exact: true })
        .click();
      await expect(page.locator(".files-trash .file-item")).toHaveCount(0);
      await expect(
        fs.readdir(path.join(host.userDirectory, ".eden-trash")),
      ).resolves.toEqual([]);
      await expect(
        fs.readFile(
          path.join(drive, ".eden-trash", "drive.txt", "content"),
          "utf8",
        ),
      ).resolves.toBe("contents of drive.txt");
      await rightClick(sidebarTrash);
      await expect
        .poll(menuItems)
        .toEqual([{ label: "Empty Trash", disabled: true }]);
    } finally {
      await host.electronApp?.evaluate(() => {
        (
          globalThis as typeof globalThis & {
            __edenIntegration: { eden: Eden };
          }
        ).__edenIntegration.eden.volumes.unregister("sidebar-trash-drive");
      });
    }
  });

  test("keeps valid sidebar actions available when another entry has damaged metadata", async () => {
    await seed("valid.txt");
    await seed("damaged.txt");
    const root = path.join(getHost().userDirectory, ".eden-trash");
    await fs.writeFile(
      path.join(root, "damaged.txt", "metadata.json"),
      "invalid metadata",
    );
    const page = await getHost().launchApp(appId);
    await rightClick(page.getByRole("button", { name: "Trash", exact: true }));
    await choose("Empty Trash");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Empty Trash", exact: true })
      .click();
    await expect.poll(() => fs.readdir(root)).toEqual(["damaged.txt"]);
    await expect(page.getByRole("dialog")).toContainText(
      "Some Trash items could not be loaded",
    );
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "OK", exact: true })
      .click();
    await expect(
      fs.readFile(path.join(root, "damaged.txt", "content"), "utf8"),
    ).resolves.toBe("contents of damaged.txt");
  });

  test("permanently deletes volume items through keyboard, context menu, and selection without creating Trash", async () => {
    const host = getHost();
    const drive = path.join(host.root, "permanent-delete-drive");
    await fs.mkdir(path.join(drive, "Folder"), { recursive: true });
    await fs.writeFile(
      path.join(drive, "Folder", "nested.txt"),
      "nested contents",
    );
    for (const name of ["keyboard.txt", "context.txt", "bulk.txt"])
      await fs.writeFile(path.join(drive, name), name);
    await fs.symlink("missing.txt", path.join(drive, "dangling.txt"));
    const register = async (readOnly = false) =>
      host.electronApp?.evaluate(
        async (_electron, input) => {
          const { eden } = (
            globalThis as typeof globalThis & {
              __edenIntegration: { eden: Eden };
            }
          ).__edenIntegration;
          eden.volumes.unregister("permanent-delete-drive");
          await eden.runPromise(
            eden.volumes.register({
              id: "permanent-delete-drive",
              label: "No Trash drive",
              kind: "removable",
              rootPath: input.drive,
              readOnly: input.readOnly,
            }),
          );
        },
        { drive, readOnly },
      );
    await register();
    try {
      const page = await host.launchApp(appId);
      const openDrive = () =>
        page
          .locator('[data-volume="permanent-delete-drive"] .eden-sidebar-item')
          .click();
      await openDrive();
      const rows = page.locator(".file-item");
      const keyboard = rows.filter({
        has: page.getByText("keyboard.txt", { exact: true }),
      });
      await keyboard.locator(".file-item-main").click();
      await page.keyboard.press("Delete");
      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText("This volume does not use Trash");
      await expect(dialog).toContainText("This cannot be undone");
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(
        fs.readFile(path.join(drive, "keyboard.txt"), "utf8"),
      ).resolves.toBe("keyboard.txt");
      await page.keyboard.press("Delete");
      await dialog
        .getByRole("button", { name: "Delete permanently", exact: true })
        .click();
      await expect(keyboard).toHaveCount(0);
      const context = rows.filter({
        has: page.getByText("context.txt", { exact: true }),
      });
      await rightClick(context);
      await expect
        .poll(menuItems)
        .toContainEqual({ label: "Delete permanently", disabled: false });
      expect(await menuItems()).not.toContainEqual({
        label: "Move to Trash",
        disabled: false,
      });
      await choose("Delete permanently");
      await dialog
        .getByRole("button", { name: "Delete permanently", exact: true })
        .click();
      await expect(context).toHaveCount(0);
      await page.getByRole("button", { name: "Select", exact: true }).click();
      await page
        .getByRole("button", { name: "Select All", exact: true })
        .click();
      const bulkDelete = page.getByRole("button", {
        name: "Delete permanently",
        exact: true,
      });
      await bulkDelete.click();
      await expect(dialog).toContainText("Permanently delete 3 items?");
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(rows).toHaveCount(3);
      await bulkDelete.click();
      await dialog
        .getByRole("button", { name: "Delete permanently", exact: true })
        .click();
      await expect(rows).toHaveCount(0);
      await expect(fs.readdir(drive)).resolves.toEqual([]);
      await page.getByRole("button", { name: "Trash", exact: true }).click();
      await expect(page.locator(".files-trash .file-item")).toHaveCount(0);

      await fs.writeFile(path.join(drive, "locked.txt"), "read-only contents");
      await register(true);
      await openDrive();
      const locked = rows.filter({ hasText: "locked.txt" });
      await expect(locked).toBeVisible();
      await expect(
        locked.getByTitle("Delete permanently", { exact: true }),
      ).toHaveCount(0);
      await rightClick(locked);
      await expect
        .poll(menuItems)
        .toContainEqual({ label: "Delete permanently", disabled: true });
      await dismiss();
      await page.getByRole("button", { name: "Select", exact: true }).click();
      await locked.getByRole("checkbox").check();
      await expect(
        page.getByRole("button", { name: "Delete permanently", exact: true }),
      ).toBeDisabled();
      await page.keyboard.press("Delete");
      await expect(dialog).toHaveCount(0);
      await expect(
        fs.readFile(path.join(drive, "locked.txt"), "utf8"),
      ).resolves.toBe("read-only contents");
    } finally {
      await host.electronApp?.evaluate(() => {
        (
          globalThis as typeof globalThis & {
            __edenIntegration: { eden: Eden };
          }
        ).__edenIntegration.eden.volumes.unregister("permanent-delete-drive");
      });
    }
  });
});
