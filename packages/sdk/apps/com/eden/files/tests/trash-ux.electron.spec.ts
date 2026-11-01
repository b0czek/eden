import * as fs from "node:fs/promises";
import * as path from "node:path";
import { expect, test } from "@playwright/test";
import { pauseCommand } from "../../../../../tests/electron/support/commands.js";
import { useElectronHost } from "../../../../../tests/electron/support/host.js";

const appId = "com.eden.files";

test.describe("Trash recovery experience", () => {
  const getHost = useElectronHost({ apps: [appId] });
  const seed = async (
    name: string,
    options: { deletedAt?: string; folder?: boolean; original?: string } = {},
  ) => {
    const directory = path.join(getHost().userDirectory, ".eden-trash", name);
    await fs.mkdir(directory, { recursive: true });
    if (options.folder) await fs.mkdir(path.join(directory, "content"));
    else await fs.writeFile(path.join(directory, "content"), `deleted ${name}`);
    await fs.writeFile(
      path.join(directory, "metadata.json"),
      JSON.stringify({
        name,
        original: {
          volume: "home",
          path: options.original ?? `/Scenarios/${name}`,
        },
        deletedAt: options.deletedAt ?? new Date().toISOString(),
      }),
    );
    return directory;
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
    for (const folder of [".eden-trash", "Scenarios"]) {
      await fs.rm(path.join(host.userDirectory, folder), {
        recursive: true,
        force: true,
      });
    }
    await fs.mkdir(path.join(host.userDirectory, "Scenarios"));
    await host.executeHostCommand("db/set/su", {
      appId,
      key: "display-preferences",
      value: JSON.stringify({
        viewStyle: "grid",
        itemSize: "medium",
        sortBy: "name",
        sortOrder: "asc",
      }),
    });
  });
  test.afterEach(async () => {
    await getHost().executeHostCommand("process/stop", { appId });
  });

  test("sorts newest first across files and folders while sharing view sizing with Home", async () => {
    await seed("a-folder", {
      folder: true,
      deletedAt: "2001-01-01T12:00:00.000Z",
    });
    await seed("b-middle.txt", { deletedAt: "2002-01-01T12:00:00.000Z" });
    await seed("z-newest.txt", { deletedAt: "2003-01-01T12:00:00.000Z" });
    const page = await launch();
    const rows = page.locator(".files-trash .file-item");
    const names = rows.locator(".file-name");
    await expect(names).toHaveText([
      "z-newest.txt",
      "b-middle.txt",
      "a-folder",
    ]);
    await expect(rows.last().locator("time")).toContainText("2001");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const display = page.getByRole("dialog", {
      name: "Display Options",
      exact: true,
    });
    await expect(display.getByRole("combobox")).toHaveValue("modified");
    await expect(
      display.getByRole("option", { name: "Date deleted", exact: true }),
    ).toHaveCount(1);
    await display
      .getByRole("button", { name: "Descending", exact: true })
      .click();
    await display.getByRole("button", { name: "List", exact: true }).click();
    await display.getByRole("slider").press("Home");
    await display.getByRole("button", { name: "Close", exact: true }).click();
    await expect(names).toHaveText([
      "a-folder",
      "b-middle.txt",
      "z-newest.txt",
    ]);
    await expect(rows.first()).toHaveClass(
      /list-view.*size-tiny|size-tiny.*list-view/,
    );

    await page.getByRole("button", { name: "Home", exact: true }).click();
    await expect(page.locator(".file-item").first()).toHaveClass(
      /list-view.*size-tiny|size-tiny.*list-view/,
    );
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(display.getByRole("combobox")).toHaveValue("name");
    await expect(
      display.getByRole("button", { name: "Ascending", exact: true }),
    ).toBeVisible();
    await display.getByRole("button", { name: "Close", exact: true }).click();
    await getHost().executeHostCommand("process/stop", { appId });
    const reopened = await launch();
    await expect(reopened.locator(".files-trash .file-name")).toHaveText([
      "a-folder",
      "b-middle.txt",
      "z-newest.txt",
    ]);
  });

  test("offers another name when a concurrent save wins the restore destination", async () => {
    await seed("notes.txt");
    const host = getHost();
    const page = await launch();
    const paused = await pauseCommand(host, "fs/mv", {
      appId,
      args: {
        from: { volume: "home", path: "/.eden-trash/notes.txt/content" },
      },
    });
    try {
      await page.getByRole("button", { name: "Select", exact: true }).click();
      await page.getByRole("checkbox").check();
      await page.getByRole("button", { name: "Restore", exact: true }).click();
      await paused.waitUntilPending();
      const root = path.join(host.userDirectory, "Scenarios");
      await fs.writeFile(path.join(root, "notes.txt"), "concurrent save");
      await paused.release();
      await paused.waitUntilCompleted();
      const dialog = page.getByRole("dialog", {
        name: "Restore under another name",
        exact: true,
      });
      await expect(dialog.getByRole("textbox")).toHaveValue(
        "notes-restored.txt",
      );
      await fs.writeFile(path.join(root, "notes-restored.txt"), "another save");
      await dialog
        .getByRole("button", { name: "Restore", exact: true })
        .click();
      await expect(dialog).toContainText(
        "An item with this name already exists",
      );
      await dialog.getByRole("textbox").fill("Recovered notes ł.txt");
      await dialog
        .getByRole("button", { name: "Restore", exact: true })
        .click();
      await expect(page.locator(".files-trash .file-item")).toHaveCount(0);
      await expect(
        fs.readFile(path.join(root, "notes.txt"), "utf8"),
      ).resolves.toBe("concurrent save");
      await expect(
        fs.readFile(path.join(root, "notes-restored.txt"), "utf8"),
      ).resolves.toBe("another save");
      await expect(
        fs.readFile(path.join(root, "Recovered notes ł.txt"), "utf8"),
      ).resolves.toBe("deleted notes.txt");
    } finally {
      await paused.dispose();
    }
  });

  test("reports restored and failed items separately with expandable error details", async () => {
    await seed("good.txt");
    await seed("failed.txt", { original: "/Scenarios/blocked/failed.txt" });
    await fs.writeFile(
      path.join(getHost().userDirectory, "Scenarios", "blocked"),
      "a file, not a directory",
    );
    const page = await launch();
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await page.getByRole("button", { name: "Select All", exact: true }).click();
    await page.getByRole("button", { name: "Restore", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Completed: 1. Failed: 1.");
    await expect(dialog).toContainText("failed.txt");
    await expect(dialog.locator("pre")).not.toBeVisible();
    await dialog.getByText("Technical details", { exact: true }).click();
    await expect(dialog.locator("pre")).toContainText("blocked");
    await dialog.getByRole("button", { name: "OK", exact: true }).click();
    await expect(page.locator(".files-trash .file-name")).toHaveText([
      "failed.txt",
    ]);
    await expect(
      fs.readFile(
        path.join(getHost().userDirectory, "Scenarios", "good.txt"),
        "utf8",
      ),
    ).resolves.toBe("deleted good.txt");
    await expect(
      fs.readFile(
        path.join(
          getHost().userDirectory,
          ".eden-trash",
          "failed.txt",
          "content",
        ),
        "utf8",
      ),
    ).resolves.toBe("deleted failed.txt");
  });
});
