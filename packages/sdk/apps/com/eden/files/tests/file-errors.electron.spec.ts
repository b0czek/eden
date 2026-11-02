import * as fs from "node:fs/promises";
import * as path from "node:path";
import { expect, test } from "@playwright/test";
import { pauseCommand } from "../../../../../tests/electron/support/commands.js";
import {
  attachContextMenu,
  CONTEXT_MENU_APP_ID,
} from "../../../../../tests/electron/support/context-menu.js";
import { useElectronHost } from "../../../../../tests/electron/support/host.js";

const appId = "com.eden.files";

test.describe("Files error reporting", () => {
  const getHost = useElectronHost({ apps: [appId, CONTEXT_MENU_APP_ID] });
  test.beforeEach(async () => {
    const root = path.join(getHost().homeDirectory, "Scenarios");
    await fs.rm(root, { recursive: true, force: true });
    await fs.mkdir(root);
  });
  test.afterEach(async () => {
    await getHost().executeHostCommand("process/stop", { appId });
  });

  test("keeps a failed creation editable with a short explanation and expandable details", async () => {
    const host = getHost();
    const menu = await attachContextMenu(host);
    const page = await host.launchApp(appId);
    await page
      .locator(".file-item")
      .filter({ hasText: "Scenarios" })
      .dblclick();
    await page.getByRole("button", { name: "New", exact: true }).click();
    await menu.choose("New Folder");
    const dialog = page.getByRole("dialog", {
      name: "New Folder",
      exact: true,
    });
    await dialog.getByRole("textbox").fill("created");
    const paused = await pauseCommand(host, "fs/mkdir", {
      appId,
      args: { location: { volume: "home", path: "/Scenarios/created" } },
    });
    try {
      await dialog.getByRole("button", { name: "OK", exact: true }).click();
      await paused.waitUntilPending();
      const target = path.join(host.homeDirectory, "Scenarios", "created");
      await fs.writeFile(target, "concurrent file");
      await paused.release();
      await paused.waitUntilCompleted();
      await expect(dialog).toContainText("Failed to create folder");
      await expect(dialog.locator("pre")).not.toBeVisible();
      // Enter expands native details instead of submitting or dismissing the form.
      await dialog.locator("summary").press("Enter");
      await expect(dialog.locator("pre")).toContainText("created");
      await expect(dialog.getByRole("textbox")).toHaveValue("created");
      await dialog.getByRole("textbox").fill("another-folder");
      await dialog.getByRole("button", { name: "OK", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(fs.readFile(target, "utf8")).resolves.toBe(
        "concurrent file",
      );
      await expect(
        fs
          .stat(path.join(host.homeDirectory, "Scenarios", "another-folder"))
          .then((stat) => stat.isDirectory()),
      ).resolves.toBe(true);
    } finally {
      await paused.dispose();
    }
  });

  test("reports successful copies separately from missing source items", async () => {
    const host = getHost();
    const root = path.join(host.homeDirectory, "Scenarios");
    await fs.mkdir(path.join(root, "destination"));
    for (const name of ["good.txt", "missing.txt"])
      await fs.writeFile(path.join(root, name), name);
    const page = await host.launchApp(appId);
    await page
      .locator(".file-item")
      .filter({ hasText: "Scenarios" })
      .dblclick();
    await page.getByRole("button", { name: "Select", exact: true }).click();
    for (const name of ["good.txt", "missing.txt"])
      await page
        .getByRole("checkbox", { name: `Select ${name}`, exact: true })
        .check();
    await page.getByRole("button", { name: "Copy", exact: true }).click();
    await fs.rm(path.join(root, "missing.txt"));
    await page
      .locator(".file-item")
      .filter({ hasText: "destination" })
      .dblclick();
    await page.getByRole("button", { name: "Copy here", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Completed: 1. Failed: 1.");
    await expect(dialog.locator(".files-failure-list")).toContainText(
      "missing.txt",
    );
    await expect(dialog.locator("pre")).not.toBeVisible();
    await dialog.locator("summary").press("Enter");
    await expect(dialog.locator("pre")).toHaveText(
      "The source item no longer exists",
    );
    await dialog.getByRole("button", { name: "OK", exact: true }).click();
    await expect(
      fs.readFile(path.join(root, "destination", "good.txt"), "utf8"),
    ).resolves.toBe("good.txt");
    await expect(fs.readdir(path.join(root, "destination"))).resolves.toEqual([
      "good.txt",
    ]);
  });
});
