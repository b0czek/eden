import * as fs from "node:fs/promises";
import * as path from "node:path";
import { expect, test } from "@playwright/test";
import {
  attachContextMenu,
  CONTEXT_MENU_APP_ID,
} from "../../../../../tests/electron/support/context-menu.js";
import { useElectronHost } from "../../../../../tests/electron/support/host.js";

const appId = "com.eden.files";

test.describe("Files display menu", () => {
  const getHost = useElectronHost({ apps: [appId, CONTEXT_MENU_APP_ID] });

  test("shows the current display choices and applies a new one", async () => {
    const host = getHost();
    const root = path.join(host.homeDirectory, "Scenarios");
    await fs.rm(root, { recursive: true, force: true });
    await fs.mkdir(root);
    for (const name of ["a.txt", "b.txt"])
      await fs.writeFile(path.join(root, name), name);
    const menu = await attachContextMenu(host);
    const page = await host.launchApp(appId);
    await page
      .locator(".file-item")
      .filter({ hasText: "Scenarios" })
      .dblclick();
    const names = page.locator(".file-list .file-name");
    await expect(names).toHaveText(["a.txt", "b.txt"]);
    const openMenu = () =>
      page
        .getByRole("button", { name: "Display Options", exact: true })
        .click();

    await openMenu();
    await expect(menu.item("Grid")).toHaveAttribute("aria-checked", "true");
    await expect(menu.item("List")).toHaveAttribute("aria-checked", "false");
    await expect(menu.item("Ascending")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await menu.choose("List");
    await expect(page.locator(".file-list")).toHaveClass(/list-view/);

    await openMenu();
    await expect(menu.item("List")).toHaveAttribute("aria-checked", "true");
    await menu.choose("Descending");
    await expect(names).toHaveText(["b.txt", "a.txt"]);

    await host.executeHostCommand("process/stop", { appId });
  });
});
