import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Eden } from "@edenapp/sdk";
import { expect, type Locator, test } from "@playwright/test";
import {
  type ElectronPage,
  useElectronHost,
} from "../../../../../tests/electron/support/host.js";

const appId = "com.eden.files";
const menuId = "com.eden.context-menu";

const trashRows = (page: ElectronPage) =>
  page.locator(".files-trash .file-item");
const row = (rows: Locator, name: string) =>
  rows.filter({ has: rows.page().locator(".file-name", { hasText: name }) });

async function openFolder(page: ElectronPage, name: string) {
  await page.locator(".file-item").filter({ hasText: name }).dblclick();
}

async function trashItem(page: ElectronPage, name: string) {
  const item = row(page.locator(".file-item"), name);
  await item.hover();
  await item.getByTitle("Move to Trash", { exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Move to Trash", exact: true })
    .click();
  await expect(item).toHaveCount(0);
}

async function restoreItem(page: ElectronPage, item: Locator) {
  const checkbox = item.getByRole("checkbox");
  if (!(await checkbox.count()))
    await page.getByRole("button", { name: "Select", exact: true }).click();
  await checkbox.check();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
}

test.describe("Files Trash", () => {
  const getHost = useElectronHost({ apps: [appId, menuId] });
  const scenarios = () => path.join(getHost().userDirectory, "Scenarios");
  const storage = () => path.join(getHost().userDirectory, ".eden-trash");

  const evaluateMenu = (script: string) =>
    getHost().evaluateApp(menuId, script);
  const menuOpen = () =>
    evaluateMenu(
      `document.querySelector('#context-menu-root').classList.contains('is-open')`,
    );
  const choose = async (label: string) => {
    await expect
      .poll(() =>
        evaluateMenu(
          `Array.from(document.querySelectorAll('#context-menu-root.is-open .context-menu-item:not([aria-disabled="true"])')).map(item => item.textContent)`,
        ),
      )
      .toContain(label);
    await evaluateMenu(
      `Array.from(document.querySelectorAll('.context-menu-item')).find(item => item.textContent === ${JSON.stringify(label)}).click()`,
    );
    await expect.poll(menuOpen).toBe(false);
  };
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
    await expect.poll(menuOpen).toBe(true);
  };

  test.beforeEach(async () => {
    const host = getHost();
    await fs.rm(storage(), { recursive: true, force: true });
    await fs.rm(scenarios(), { recursive: true, force: true });
    await fs.mkdir(scenarios());
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
    await getHost().executeHostCommand("process/stop", { appId });
  });

  test("moves a selection to Trash and restores it, recreating missing folders", async () => {
    const host = getHost();
    await fs.mkdir(path.join(scenarios(), "Project", "Assets"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(scenarios(), "Project", "Assets", "logo.txt"),
      "logo",
    );
    await fs.writeFile(path.join(scenarios(), "Project", "notes.txt"), "notes");
    const page = await host.launchApp(appId);
    await expect(
      page.locator(".file-item").filter({ hasText: ".eden-trash" }),
    ).toHaveCount(0);
    await openFolder(page, "Scenarios");
    await openFolder(page, "Project");
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
    const rows = trashRows(page);
    await expect(rows).toHaveCount(2);
    await expect(row(rows, "notes.txt")).toContainText("/Scenarios/Project");
    await page.getByRole("button", { name: "Go Back", exact: true }).click();
    await expect(page.locator(".files-trash")).toHaveCount(0);
    await page.getByRole("button", { name: "Go Forward", exact: true }).click();
    await expect(rows).toHaveCount(2);

    await fs.rm(path.join(scenarios(), "Project"), { recursive: true });
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await page.getByRole("button", { name: "Select All", exact: true }).click();
    await page.getByRole("button", { name: "Restore", exact: true }).click();
    await expect(
      page.getByText("Trash is empty", { exact: true }),
    ).toBeVisible();
    await expect(
      fs.readFile(
        path.join(scenarios(), "Project", "Assets", "logo.txt"),
        "utf8",
      ),
    ).resolves.toBe("logo");
    await expect(
      fs.readFile(path.join(scenarios(), "Project", "notes.txt"), "utf8"),
    ).resolves.toBe("notes");
    await expect(fs.readdir(storage())).resolves.toEqual([]);
  });

  test("asks for another name when the original location is occupied", async () => {
    const host = getHost();
    const file = path.join(scenarios(), "notes.txt");
    await fs.writeFile(file, "original contents");
    const page = await host.launchApp(appId);
    await openFolder(page, "Scenarios");
    await trashItem(page, "notes.txt");
    await fs.writeFile(file, "replacement contents");
    await page.getByRole("button", { name: "Trash", exact: true }).click();
    const rows = trashRows(page);
    await restoreItem(page, rows);
    const dialog = page.getByRole("dialog");
    await expect(dialog).toHaveAccessibleName("Restore under another name");
    await expect(dialog.getByRole("textbox")).toHaveValue("notes-restored.txt");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(rows).toHaveCount(1);

    await restoreItem(page, rows);
    await dialog.getByRole("textbox").fill("../escape.txt");
    await dialog.getByRole("button", { name: "Restore", exact: true }).click();
    await expect(dialog).toContainText("Invalid file or folder name");
    await dialog.getByRole("textbox").fill("notes.txt");
    await dialog.getByRole("button", { name: "Restore", exact: true }).click();
    await expect(dialog).toContainText("An item with this name already exists");
    await dialog.getByRole("textbox").fill("notes-restored.txt");
    await dialog.getByRole("button", { name: "Restore", exact: true }).click();
    await expect(rows).toHaveCount(0);
    await expect(fs.readFile(file, "utf8")).resolves.toBe(
      "replacement contents",
    );
    await expect(
      fs.readFile(path.join(scenarios(), "notes-restored.txt"), "utf8"),
    ).resolves.toBe("original contents");
  });

  test("restores from details, deletes permanently, and empties Trash from menus", async () => {
    const host = getHost();
    for (const name of ["details.txt", "delete.txt", "keep.txt"])
      await fs.writeFile(path.join(scenarios(), name), name);
    const page = await host.launchApp(appId);
    await openFolder(page, "Scenarios");
    for (const name of ["details.txt", "delete.txt", "keep.txt"])
      await trashItem(page, name);
    await page.getByRole("button", { name: "Trash", exact: true }).click();
    const rows = trashRows(page);
    await expect(rows).toHaveCount(3);

    await rightClick(row(rows, "details.txt"));
    await choose("Details");
    const details = page.getByRole("dialog", { name: "Details", exact: true });
    await expect(details).toContainText("Original location");
    await expect(details).toContainText("/Scenarios/details.txt");
    await expect(details).toContainText("Date deleted");
    await details.getByRole("button", { name: "Restore", exact: true }).click();
    await expect(rows).toHaveCount(2);
    await expect(
      fs.readFile(path.join(scenarios(), "details.txt"), "utf8"),
    ).resolves.toBe("details.txt");

    const confirm = page.getByRole("dialog");
    await rightClick(row(rows, "delete.txt"));
    await choose("Delete permanently");
    await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(rows).toHaveCount(2);
    await rightClick(row(rows, "delete.txt"));
    await choose("Delete permanently");
    await confirm
      .getByRole("button", { name: "Delete permanently", exact: true })
      .click();
    await expect(rows).toHaveCount(1);
    await expect(row(rows, "keep.txt")).toHaveCount(1);

    await rightClick(page.locator(".files-trash .explorer-content"), true);
    await choose("Empty Trash");
    await confirm
      .getByRole("button", { name: "Empty Trash", exact: true })
      .click();
    await expect(rows).toHaveCount(0);
    await expect(fs.readdir(storage())).resolves.toEqual([]);
    await expect(fs.readdir(scenarios())).resolves.toEqual(["details.txt"]);
  });
});

test.describe("Files Trash with restricted Home and another volume", () => {
  const getHost = useElectronHost({ apps: [appId] });

  test("shows each account only its own items and deletes volume items permanently", async () => {
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
    const login = (username: string) =>
      app.evaluate(async (_electron, username) => {
        const { eden } = (
          globalThis as typeof globalThis & {
            __edenIntegration: { eden: Eden };
          }
        ).__edenIntegration;
        await eden.runPromise(eden.sessions.login(username, "password"));
      }, username);
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
      await eden.runPromise(
        eden.volumes.register({
          id: "trash-drive",
          label: "Trash drive",
          kind: "removable",
          rootPath,
        }),
      );
    }, driveRoot);
    await login("scoped");

    let page = await host.launchApp(appId);
    const item = page.locator(".file-item").filter({ hasText: "home.txt" });
    await item.locator(".file-item-main").click();
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
      .getByRole("button", { name: "Delete permanently", exact: true })
      .click();
    await expect(volumeFile).toHaveCount(0);
    await expect(fs.readdir(driveRoot)).resolves.toEqual([]);

    await page.getByRole("button", { name: "Trash", exact: true }).click();
    await expect(trashRows(page)).toHaveCount(1);
    await expect(trashRows(page)).toContainText("home.txt");

    await host.executeHostCommand("process/stop", { appId });
    await login("second");
    page = await host.launchApp(appId);
    await page.getByRole("button", { name: "Trash", exact: true }).click();
    await expect(
      page.getByText("Trash is empty", { exact: true }),
    ).toBeVisible();
    await expect(
      fs.readdir(path.join(host.userDirectory, ".eden-trash")),
    ).resolves.toHaveLength(1);
    await host.executeHostCommand("process/stop", { appId });
  });
});
