import { expect } from "@playwright/test";
import type { ElectronHost } from "./host";

export const CONTEXT_MENU_APP_ID = "com.eden.context-menu";

/**
 * Attach to the context-menu app, launching it if needed. The host must list
 * {@link CONTEXT_MENU_APP_ID} in its `apps`.
 */
export async function attachContextMenu(host: ElectronHost) {
  const running = host.electronApp
    ?.context()
    .pages()
    .find((page) => page.url().includes(CONTEXT_MENU_APP_ID));
  const page = running ?? (await host.launchApp(CONTEXT_MENU_APP_ID));
  const root = page.locator("#context-menu-root");
  const panel = page.locator("#context-menu-root.is-open #context-menu");
  const item = (label: string) =>
    panel.locator(".context-menu-item").filter({
      has: page.locator(".context-menu-label").getByText(label, {
        exact: true,
      }),
    });

  return {
    page,
    /** The menu panel; visible only while a menu is open. */
    panel,
    title: panel.locator("#context-menu-title"),
    item,
    async choose(label: string) {
      await item(label).click();
      await expect(root).not.toHaveClass(/is-open/);
    },
    async dismiss() {
      await page.locator("#context-menu-overlay").dispatchEvent("click");
      await expect(root).not.toHaveClass(/is-open/);
    },
  };
}

export type ContextMenu = Awaited<ReturnType<typeof attachContextMenu>>;
