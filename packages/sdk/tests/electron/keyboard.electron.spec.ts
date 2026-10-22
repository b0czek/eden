import { expect, test } from "@playwright/test";
import { APP_ID } from "./support/fixtures";
import { useElectronHost } from "./support/host";

test.describe
  .serial("keyboard through Electron", () => {
    const getHost = useElectronHost({
      fixtures: ["integration"],
      launchFixture: true,
    });
    test("supports keyboard focus, policy, and input across nested shadow DOM", async () => {
      const host = getHost();

      const focused = await host.electronApp?.evaluate(
        ({ webContents }, appId) => {
          const contents = webContents
            .getAllWebContents()
            .find((candidate) => candidate.getURL().includes(appId));
          if (!contents) throw new Error("Integration app view not found");

          contents.focus();
          return contents.executeJavaScript(`(() => {
            const input = document
              .getElementById("shadow-input-host")
              .shadowRoot
              .getElementById("inner-shadow-input-host")
              .shadowRoot
              .getElementById("shadow-input");
            input.focus();
            return input === input.getRootNode().activeElement;
          })()`);
        },
        APP_ID,
      );
      expect(focused).toBe(true);

      await expect
        .poll(async () => {
          return host.electronApp?.evaluate(({ webContents }, appId) => {
            const contents = webContents
              .getAllWebContents()
              .find((candidate) => candidate.getURL().includes(appId));
            if (!contents) return false;

            return contents.executeJavaScript(`window.edenKeyboard
              .getState()
              .then(({ visible, placementMode, target }) => ({
                visible,
                placementMode,
                targetKind: target?.kind,
              }))`);
          }, APP_ID);
        })
        .toEqual({
          visible: true,
          placementMode: "floating",
          targetKind: "input",
        });

      const actionResult = await host.electronApp?.evaluate(
        ({ webContents }) => {
          const contents = webContents
            .getAllWebContents()
            .find((candidate) =>
              candidate.getURL().includes("keyboard-ui/index.html"),
            );
          if (!contents) throw new Error("Keyboard view not found");

          return contents.executeJavaScript(
            'window.edenKeyboard.sendAction({ type: "insertText", text: "Eden" })',
          );
        },
      );
      expect(actionResult).toEqual({ success: true });

      await expect
        .poll(async () => {
          return host.electronApp?.evaluate(({ webContents }, appId) => {
            const contents = webContents
              .getAllWebContents()
              .find((candidate) => candidate.getURL().includes(appId));
            if (!contents) return undefined;

            return contents.executeJavaScript(
              "document.body.dataset.shadowInputValue",
            );
          }, APP_ID);
        })
        .toBe("Eden");
    });

    test("edits number inputs and hides the on-screen keyboard", async () => {
      const host = getHost();

      const focused = await host.electronApp?.evaluate(
        ({ webContents }, appId) => {
          const contents = webContents
            .getAllWebContents()
            .find((candidate) => candidate.getURL().includes(appId));
          if (!contents) throw new Error("Integration app view not found");

          contents.focus();
          return contents.executeJavaScript(`(() => {
          const input = document.getElementById("number-input");
          input.focus();
          return input === document.activeElement;
        })()`);
        },
        APP_ID,
      );
      expect(focused).toBe(true);

      await expect
        .poll(async () => {
          return host.electronApp?.evaluate(({ webContents }, appId) => {
            const contents = webContents
              .getAllWebContents()
              .find((candidate) => candidate.getURL().includes(appId));
            if (!contents) return undefined;

            return contents.executeJavaScript(`window.edenKeyboard
              .getState()
              .then(({ visible, target }) => ({
                visible,
                inputType: target?.inputType,
              }))`);
          }, APP_ID);
        })
        .toEqual({ visible: true, inputType: "number" });

      const actionResults = await host.electronApp?.evaluate(
        ({ webContents }) => {
          const contents = webContents
            .getAllWebContents()
            .find((candidate) =>
              candidate.getURL().includes("keyboard-ui/index.html"),
            );
          if (!contents) throw new Error("Keyboard view not found");

          return contents.executeJavaScript(`(async () => [
          await window.edenKeyboard.sendAction({ type: "insertText", text: "4" }),
          await window.edenKeyboard.sendAction({ type: "insertText", text: "2" }),
          await window.edenKeyboard.sendAction({ type: "backspace" }),
        ])()`);
        },
      );
      expect(actionResults).toEqual([
        { success: true },
        { success: true },
        { success: true },
      ]);

      await expect
        .poll(async () => {
          return host.electronApp?.evaluate(({ webContents }, appId) => {
            const contents = webContents
              .getAllWebContents()
              .find((candidate) => candidate.getURL().includes(appId));
            if (!contents) return undefined;

            return contents.executeJavaScript(
              "document.body.dataset.numberInputValue",
            );
          }, APP_ID);
        })
        .toBe("4");

      const hideResult = await host.electronApp?.evaluate(({ webContents }) => {
        const contents = webContents
          .getAllWebContents()
          .find((candidate) =>
            candidate.getURL().includes("keyboard-ui/index.html"),
          );
        if (!contents) throw new Error("Keyboard view not found");

        return contents.executeJavaScript("window.edenKeyboard.hide()");
      });
      expect(hideResult).toEqual({ success: true });

      await expect
        .poll(async () => {
          return host.electronApp?.evaluate(({ webContents }, appId) => {
            const contents = webContents
              .getAllWebContents()
              .find((candidate) => candidate.getURL().includes(appId));
            if (!contents) return undefined;

            return contents.executeJavaScript(
              "window.edenKeyboard.getState().then((state) => state.visible)",
            );
          }, APP_ID);
        })
        .toBe(false);
    });
  });

for (const shutdown of ["close foundation", "quit host"] as const) {
  test.describe(`keyboard shutdown: ${shutdown}`, () => {
    const getHost = useElectronHost();

    test("releases native listeners without accessing a destroyed window", async () => {
      const host = getHost();
      const app = host.electronApp;
      if (!app) throw new Error("Electron app is not running");
      const errors: string[] = [];
      app.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      expect(
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().some(
            (window) => window.getParentWindow() !== null,
          ),
        ),
      ).toBe(true);

      if (shutdown === "close foundation") {
        const exited = new Promise<void>((resolve) =>
          app.once("close", () => resolve()),
        );
        await app.evaluate(({ BrowserWindow }) => {
          const foundation = BrowserWindow.getAllWindows().find(
            (window) => window.getTitle() === "Eden Electron Integration",
          );
          if (!foundation) throw new Error("Foundation window is unavailable");
          foundation.close();
        });
        await exited;
      } else {
        await app.close();
      }
      host.electronApp = undefined;
      expect(errors).toEqual([]);
    });
  });
}
