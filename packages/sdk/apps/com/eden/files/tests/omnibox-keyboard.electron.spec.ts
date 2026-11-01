import { expect, test } from "@playwright/test";
import { useElectronHost } from "../../../../../tests/electron/support/host.js";

const appId = "com.eden.files";

test.describe("Files address editing with the on-screen keyboard", () => {
  const getHost = useElectronHost({ apps: [appId] });
  test.afterEach(async () => {
    await getHost().executeHostCommand("process/stop", { appId });
  });

  for (const placementMode of ["docked", "floating"] as const) {
    test(`keeps the Trash address and ${placementMode} keyboard stable while editing`, async () => {
      const host = getHost();
      await host.executeHostCommand("settings/set/su", {
        appId: "com.eden",
        key: "keyboard.placementMode",
        value: placementMode,
      });
      const page = await host.launchApp(appId);
      await page.evaluate(() => {
        document.addEventListener(
          "focusin",
          (event) => {
            if (
              event.target instanceof HTMLInputElement &&
              event.target.matches(".omnibox-input")
            ) {
              event.target.dataset.valueOnFocus = event.target.value;
            }
          },
          true,
        );
      });
      await page.getByRole("button", { name: "Trash", exact: true }).click();
      const session = await page.context().newCDPSession(page);
      try {
        await session.send("Emulation.setTouchEmulationEnabled", {
          enabled: true,
          maxTouchPoints: 1,
        });
        const address = page.getByRole("button", {
          name: "Edit path",
          exact: true,
        });
        const bounds = await address.boundingBox();
        if (!bounds) throw new Error("Address bar unavailable");
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
        const input = page.locator(".omnibox-input");
        const state = () => page.evaluate(() => window.edenKeyboard.getState());
        await expect(input).toHaveValue("/Trash");
        await expect(input).toHaveAttribute("data-value-on-focus", "/Trash");
        await expect(input).toBeFocused();
        await expect.poll(async () => (await state()).visible).toBe(true);
        await expect(page.locator(".suggestion-item")).toHaveCount(0);

        // Submitting the displayed name must keep this virtual location open.
        await input.press("Enter");
        await expect(page.locator(".files-trash")).toBeVisible();
        await expect(address).toHaveText("/Trash");
        await expect.poll(async () => (await state()).visible).toBe(false);
        await address.click();
        await expect(input).toHaveValue("/Trash");
        await expect.poll(async () => (await state()).visible).toBe(true);

        // A value update from app code must preserve the focused input and OSK.
        await input.evaluate((element) => {
          element.value = "/external-update";
          element.dispatchEvent(
            new InputEvent("input", {
              bubbles: true,
              inputType: "insertReplacementText",
              data: element.value,
            }),
          );
        });
        await expect(input).toHaveValue("/external-update");
        await expect(input).toBeFocused();
        const keyboard = host.electronApp
          ?.context()
          .pages()
          .find((candidate) =>
            candidate.url().includes("keyboard-ui/index.html"),
          );
        if (!keyboard) throw new Error("Keyboard page unavailable");
        await keyboard.locator('[data-skbtn="q"]').click();
        await expect(input).toHaveValue("/external-updateq");
        await expect(page.locator(".omnibox-loading")).toHaveCount(0);
        await expect(input).toBeFocused();
        await expect.poll(async () => (await state()).visible).toBe(true);

        // Editing an ordinary path still navigates, and leaving the field hides OSK.
        await input.fill("/");
        await expect(page.locator(".omnibox-loading")).toHaveCount(0);
        await input.press("Enter");
        await expect(page.locator(".files-trash")).toHaveCount(0);
        await expect(address).toHaveText("/");
        await expect.poll(async () => (await state()).visible).toBe(false);
        await address.click();
        await expect(input).toHaveValue("/");
        await expect(input).toHaveAttribute("data-value-on-focus", "/");
        await expect(input).toBeFocused();
        await expect.poll(async () => (await state()).visible).toBe(true);
        await input.press("Escape");
        await expect.poll(async () => (await state()).visible).toBe(false);
      } finally {
        await session.detach();
      }
    });
  }
});
