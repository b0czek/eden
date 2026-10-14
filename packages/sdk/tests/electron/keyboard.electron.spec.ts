import { expect, test } from "@playwright/test";
import { useElectronHost } from "./support/host";
import { APP_ID, PDF_VIEWER_APP_ID } from "./support/profile";

test.describe
  .serial("keyboard through Electron", () => {
    const getHost = useElectronHost();
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

    test("edits number inputs with the on-screen keyboard", async () => {
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
    });

    test("types into the PDF viewer search input with the on-screen keyboard", async () => {
      const host = getHost();

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

      const launchResult = await host.executeHostCommand<{
        success: boolean;
        appId: string;
      }>("process/launch", { appId: PDF_VIEWER_APP_ID });
      expect(launchResult).toMatchObject({
        success: true,
        appId: PDF_VIEWER_APP_ID,
      });

      const clickPdfSearchButton = async () => {
        return host.electronApp?.evaluate(async ({ webContents }, appId) => {
          const contents = webContents
            .getAllWebContents()
            .find((candidate) => candidate.getURL().includes(appId));
          if (!contents) throw new Error("PDF viewer app view not found");

          const point = await contents.executeJavaScript(`(() => {
            const button = document
              .querySelector("embedpdf-container")
              .shadowRoot
              .querySelector('button[aria-label="Search"]');
            if (!button) throw new Error("PDF search button not found");
            const rect = button.getBoundingClientRect();
            return {
              x: Math.round(rect.x + rect.width / 2),
              y: Math.round(rect.y + rect.height / 2),
            };
          })()`);
          contents.focus();
          contents.sendInputEvent({
            type: "mouseDown",
            button: "left",
            clickCount: 1,
            ...point,
          });
          contents.sendInputEvent({
            type: "mouseUp",
            button: "left",
            clickCount: 1,
            ...point,
          });
        }, PDF_VIEWER_APP_ID);
      };

      await expect
        .poll(() =>
          host.electronApp?.evaluate(
            ({ webContents }, appId) =>
              webContents
                .getAllWebContents()
                .some((contents) => contents.getURL().includes(appId)),
            PDF_VIEWER_APP_ID,
          ),
        )
        .toBe(true);

      await host.electronApp?.evaluate(async ({ webContents }, appId) => {
        const contents = webContents
          .getAllWebContents()
          .find((candidate) => candidate.getURL().includes(appId));
        if (!contents) throw new Error("PDF viewer app view not found");

        return contents.executeJavaScript(`(async () => {
            const container = document.querySelector("embedpdf-container");
            const registry = await container.registry;
            const documentManager = registry
              .getPlugin("document-manager")
              .provides();
            const response = await fetch(new URL("demo.pdf", location.href));
            const buffer = await response.arrayBuffer();
            await documentManager.openDocumentBuffer({
              buffer,
              name: "demo.pdf",
              documentId: "osk-search-test",
            }).toPromise();
          })()`);
      }, PDF_VIEWER_APP_ID);

      await clickPdfSearchButton();

      await expect
        .poll(() =>
          host.electronApp?.evaluate(({ webContents }, appId) => {
            const contents = webContents
              .getAllWebContents()
              .find((candidate) => candidate.getURL().includes(appId));
            if (!contents) return false;

            return contents.executeJavaScript(`(() => {
              const root = document.querySelector("embedpdf-container").shadowRoot;
              const activeElement = root.activeElement;
              return {
                searchPanel: Boolean(root.querySelector(
                  '[data-sidebar-id="search-panel"]',
                )),
                searchInput: Boolean(root.querySelector(
                  'input[placeholder="Search"]',
                )),
                activeTag: activeElement?.tagName ?? null,
                activeLabel: activeElement?.getAttribute("aria-label") ?? null,
              };
            })()`);
          }, PDF_VIEWER_APP_ID),
        )
        .toEqual({
          searchPanel: true,
          searchInput: true,
          activeTag: "INPUT",
          activeLabel: null,
        });

      await expect
        .poll(async () => {
          return host.electronApp?.evaluate(async ({ webContents }, appId) => {
            const contents = webContents
              .getAllWebContents()
              .find((candidate) => candidate.getURL().includes(appId));
            if (!contents) return false;

            return contents.executeJavaScript(`window.edenKeyboard
              .getState()
              .then((state) => ({
                visible: state.visible,
                targetKind: state.target?.kind ?? null,
                documentFocused: document.hasFocus(),
              }))`);
          }, PDF_VIEWER_APP_ID);
        })
        .toEqual({
          visible: true,
          targetKind: "input",
          documentFocused: true,
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
            'window.edenKeyboard.sendAction({ type: "insertText", text: "invoice" })',
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

            return contents.executeJavaScript(`document
                .querySelector("embedpdf-container")
                .shadowRoot
                .querySelector('input[placeholder="Search"]')
                .value`);
          }, PDF_VIEWER_APP_ID);
        })
        .toBe("invoice");

      await clickPdfSearchButton();

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
          }, PDF_VIEWER_APP_ID);
        })
        .toBe(false);

      await clickPdfSearchButton();

      await expect
        .poll(async () => {
          return host.electronApp?.evaluate(({ webContents }, appId) => {
            const contents = webContents
              .getAllWebContents()
              .find((candidate) => candidate.getURL().includes(appId));
            if (!contents) return undefined;

            return contents.executeJavaScript(`Promise.all([
                window.edenKeyboard.getState(),
                Promise.resolve(document
                  .querySelector("embedpdf-container")
                  .shadowRoot
                  .activeElement
                  ?.matches('input[placeholder="Search"]') ?? false),
              ]).then(([state, focused]) => ({
                visible: state.visible,
                focused,
              }))`);
          }, PDF_VIEWER_APP_ID);
        })
        .toEqual({ visible: true, focused: true });
    });
  });
