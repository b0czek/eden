import { expect, test } from "@playwright/test";
import {
  attachContextMenu,
  CONTEXT_MENU_APP_ID,
} from "../../../../../tests/electron/support/context-menu.js";
import { APP_ID } from "../../../../../tests/electron/support/fixtures.js";
import { useElectronHost } from "../../../../../tests/electron/support/host.js";

const pickerId = "com.eden.file-picker";

test.describe("File Picker display menu", () => {
  const getHost = useElectronHost({
    fixtures: ["integration"],
    apps: [pickerId, CONTEXT_MENU_APP_ID],
    launchFixture: true,
  });

  test("changes the picker view from the display menu", async () => {
    const host = getHost();
    const menu = await attachContextMenu(host);
    await host.evaluateApp(
      APP_ID,
      `window.edenAPI.shellCommand('file-picker/open', { mode: 'open' })`,
    );
    await expect
      .poll(() =>
        host.electronApp
          ?.context()
          .pages()
          .some((page) => page.url().includes(pickerId)),
      )
      .toBe(true);
    const picker = host.electronApp
      ?.context()
      .pages()
      .find((page) => page.url().includes(pickerId));
    if (!picker) throw new Error("File picker page unavailable");
    const list = picker.locator(".file-list");
    await expect(list).toHaveClass(/list-view/);

    await picker
      .getByRole("button", { name: "Display Options", exact: true })
      .click();
    await expect(menu.item("List")).toHaveAttribute("aria-checked", "true");
    const stack = await host.electronApp?.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().flatMap((window) =>
        window.contentView.children.map((view) =>
          "webContents" in view
            ? (view as import("electron").WebContentsView).webContents.getURL()
            : "",
        ),
      ),
    );
    const stackIndex = (appId: string) =>
      stack?.findIndex((url) => url.includes(appId)) ?? -1;
    expect(stackIndex(CONTEXT_MENU_APP_ID)).toBeGreaterThan(
      stackIndex(pickerId),
    );
    await menu.choose("Grid");
    await expect(list).not.toHaveClass(/list-view/);
  });
});
