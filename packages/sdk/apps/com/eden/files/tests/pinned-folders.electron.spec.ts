import * as fs from "node:fs/promises";
import * as path from "node:path";
import { expect, test } from "@playwright/test";
import { pauseCommand } from "../../../../../tests/electron/support/commands.js";
import { useElectronHost } from "../../../../../tests/electron/support/host.js";

const appId = "com.eden.files";
const projects = { volume: "home", path: "/Projects" };

test.describe("Files pinned folders", () => {
  const getHost = useElectronHost({ apps: [appId] });

  test.beforeEach(async () => {
    const host = getHost();
    await fs.mkdir(path.join(host.userDirectory, "Projects"), {
      recursive: true,
    });
    await host.executeHostCommand("db/set/su", {
      appId,
      key: "pinned-folders",
      value: "[]",
    });
  });

  test.afterEach(async () => {
    await getHost().executeHostCommand("process/stop", { appId });
  });

  test("Enter selects a color or cancels, and saving persists the chosen pin across launches", async () => {
    const host = getHost();
    const page = await host.launchApp(appId);
    await page.locator(".file-item").filter({ hasText: "Projects" }).dblclick();
    await expect(
      page.getByRole("button", { name: "Edit path", exact: true }),
    ).toHaveText("/Projects");
    const pinCurrent = page.getByRole("button", {
      name: "Pin current folder",
      exact: true,
    });
    await pinCurrent.click();
    const dialog = page.getByRole("dialog");
    const purple = dialog.getByRole("button", { name: "Purple", exact: true });
    await purple.press("Enter");
    await expect(dialog).toBeVisible();
    await expect(purple).toHaveAttribute("aria-pressed", "true");
    await dialog
      .getByRole("button", { name: "Cancel", exact: true })
      .press("Enter");
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Projects", exact: true }),
    ).toHaveCount(0);
    await expect(
      host.executeHostCommand("db/get/su", { appId, key: "pinned-folders" }),
    ).resolves.toEqual({ value: "[]" });

    await pinCurrent.click();
    await dialog
      .getByRole("button", { name: "Purple", exact: true })
      .press("Enter");
    await dialog
      .getByRole("button", { name: "Pin folder", exact: true })
      .press("Enter");
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Projects", exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () => {
        const { value } = await host.executeHostCommand<{ value: string }>(
          "db/get/su",
          { appId, key: "pinned-folders" },
        );
        return JSON.parse(value);
      })
      .toEqual([{ location: projects, label: "Projects", color: "purple" }]);
    await host.executeHostCommand("process/stop", { appId });
    const reopened = await host.launchApp(appId);
    await reopened
      .getByRole("button", { name: "Projects", exact: true })
      .click();
    await expect(
      reopened.getByRole("button", { name: "Edit path", exact: true }),
    ).toHaveText("/Projects");
  });

  test("Home stays selected when an older pinned-folder lookup finishes late", async () => {
    const host = getHost();
    await host.executeHostCommand("db/set/su", {
      appId,
      key: "pinned-folders",
      value: JSON.stringify([
        { location: projects, label: "Projects pin", color: "blue" },
      ]),
    });
    const page = await host.launchApp(appId);
    await expect(
      page.locator(".file-item").filter({ hasText: "Projects" }),
    ).toBeVisible();
    const lookup = await pauseCommand(host, "fs/stat", {
      appId,
      args: { location: projects },
    });
    try {
      await page
        .getByRole("button", { name: "Projects pin", exact: true })
        .click();
      await lookup.waitUntilPending();
      await page.getByRole("button", { name: "Home", exact: true }).click();
      await lookup.release();
      await lookup.waitUntilCompleted();
      // Let the delivered IPC result and its renderer continuations settle.
      await page.evaluate(
        () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
      );
      await expect(
        page.getByRole("button", { name: "Edit path", exact: true }),
      ).toHaveText("/");
      await page
        .getByRole("button", { name: "Projects pin", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Edit path", exact: true }),
      ).toHaveText("/Projects");
    } finally {
      await lookup.dispose();
    }
  });
});
