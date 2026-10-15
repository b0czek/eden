import { expect, test } from "@playwright/test";
import { useElectronHost } from "../../../../../../tests/electron/support/host.js";

test.describe
  .serial("Hello example backend", () => {
    const getHost = useElectronHost({ apps: ["com.eden.example.hello"] });

    test("handles a Hello request in the app backend", async () => {
      const host = getHost();

      const appId = "com.eden.example.hello";
      await host.executeHostCommand("process/launch", { appId });
      try {
        await expect
          .poll(() =>
            host.electronApp?.evaluate(({ webContents }, id) => {
              const contents = webContents
                .getAllWebContents()
                .find((candidate) => candidate.getURL().includes(id));
              return contents?.executeJavaScript("document.readyState");
            }, appId),
          )
          .toBe("complete");
        const response = await host.electronApp?.evaluate(
          async ({ webContents }, id) => {
            const contents = webContents
              .getAllWebContents()
              .find((candidate) => candidate.getURL().includes(id));
            if (!contents) throw new Error("Hello example view not found");
            return contents.executeJavaScript(
              'window.getAppAPI().request("hello", { message: "generated backend" })',
            );
          },
          appId,
        );
        expect(response).toEqual({
          message: "Hello from backend! You said: generated backend",
        });
      } finally {
        await host.executeHostCommand("process/stop", { appId });
      }
    });
  });
