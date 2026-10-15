import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { useElectronHost } from "../../../../../tests/electron/support/host.js";

const PDF_VIEWER_APP_ID = "com.eden.pdf-viewer";

test.describe
  .serial("PDF viewer search keyboard", () => {
    const getHost = useElectronHost({ apps: [PDF_VIEWER_APP_ID] });
    test.beforeAll(async () => {
      await fs.cp(
        fileURLToPath(
          new URL(
            "../node_modules/@embedpdf/snippet/dist/demo.pdf",
            import.meta.url,
          ),
        ),
        path.join(
          getHost().root,
          "dist/apps/prebuilt",
          PDF_VIEWER_APP_ID,
          "dist/demo.pdf",
        ),
      );
    });
    test("types into the PDF viewer search input with the on-screen keyboard", async () => {
      const host = getHost();

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
