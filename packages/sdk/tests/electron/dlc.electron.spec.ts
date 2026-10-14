import { expect, test } from "@playwright/test";
import { useElectronHost } from "./support/host";
import {
  APP_ID,
  DLC_ID,
  REMOTE_APP_ID,
  REMOTE_DLC_ID,
} from "./support/profile";

test.describe
  .serial("dlc through Electron", () => {
    const getHost = useElectronHost();
    test("loads a host-bound DLC module and rejects the same URL from another view", async () => {
      const host = getHost();

      const loaded = await host.electronApp?.evaluate(
        async ({ webContents }, { appId, dlcId }) => {
          const contents = webContents
            .getAllWebContents()
            .find((candidate) => candidate.getURL().includes(appId));
          if (!contents) throw new Error("Integration app view not found");
          return contents.executeJavaScript(`(async () => {
            const { dlcs: resources } = await window.edenAPI.shellCommand(
              "package/self",
              {},
            );
            const resource = resources.find((candidate) => candidate.manifest.id === ${JSON.stringify(dlcId)});
            const entry = resource.manifest.contributions[0].metadata.entry;
            const module = await import(new URL(entry, resource.rootUrl).href);
            return { asset: module.asset, moduleUrl: module.moduleUrl, value: module.default, rootUrl: resource.rootUrl };
          })()`);
        },
        { appId: APP_ID, dlcId: DLC_ID },
      );
      expect(loaded?.value).toBe("loaded-through-eden-dlc");
      expect(loaded?.asset).toBe("adjacent asset");
      expect(loaded?.moduleUrl).toMatch(/^eden-dlc:\/\/resource\//);
      const dlcRootUrl = loaded?.rootUrl;
      expect(dlcRootUrl).toMatch(/^eden-dlc:\/\/resource\//);

      await expect(
        host.foundation.evaluate(async (rootUrl) => {
          await fetch(new URL("dist/entry.mjs", rootUrl));
        }, dlcRootUrl),
      ).rejects.toThrow();
    });

    test("revokes DLC module URLs when the host stops", async () => {
      const host = getHost();

      const dlcRootUrl = await host.evaluateApp(
        APP_ID,
        "window.edenAPI.shellCommand('package/self', {}).then(result => result.dlcs[0].rootUrl)",
      );
      await host.executeHostCommand("process/stop", { appId: APP_ID });
      await host.executeHostCommand("process/launch", { appId: APP_ID });

      await expect
        .poll(() =>
          host.electronApp?.evaluate(
            ({ webContents }, appId) =>
              webContents
                .getAllWebContents()
                .some((candidate) => candidate.getURL().includes(appId)),
            APP_ID,
          ),
        )
        .toBe(true);

      const result = await host.electronApp?.evaluate(
        async ({ webContents }, { appId, oldRootUrl }) => {
          const contents = webContents
            .getAllWebContents()
            .find((candidate) => candidate.getURL().includes(appId));
          if (!contents) throw new Error("Relaunched app view not found");
          return contents.executeJavaScript(`(async () => {
            let oldUrlRejected = false;
            try { await import(new URL("dist/entry.mjs", ${JSON.stringify(oldRootUrl)}).href); }
            catch { oldUrlRejected = true; }
            const { dlcs: resources } = await window.edenAPI.shellCommand(
              "package/self",
              {},
            );
            return { oldUrlRejected, rootUrl: resources[0].rootUrl };
          })()`);
        },
        { appId: APP_ID, oldRootUrl: dlcRootUrl },
      );
      expect(result?.oldUrlRejected).toBe(true);
      expect(result?.rootUrl).not.toBe(dlcRootUrl);
    });

    test("supports DLC module imports from an HTTP development frontend", async () => {
      const host = getHost();

      await host.executeHostCommand("process/launch", { appId: REMOTE_APP_ID });
      await expect
        .poll(() =>
          host.electronApp?.evaluate(
            ({ webContents }, url) =>
              webContents
                .getAllWebContents()
                .some((candidate) => candidate.getURL() === url),
            host.remoteUrl,
          ),
        )
        .toBe(true);

      const value = await host.electronApp?.evaluate(
        async ({ webContents }, { url, dlcId }) => {
          const contents = webContents
            .getAllWebContents()
            .find((candidate) => candidate.getURL() === url);
          if (!contents) throw new Error("Remote app view not found");
          return contents.executeJavaScript(`(async () => {
            const { dlcs: resources } = await window.edenAPI.shellCommand(
              "package/self",
              {},
            );
            const resource = resources.find((candidate) => candidate.manifest.id === ${JSON.stringify(dlcId)});
            const module = await import(new URL(resource.manifest.contributions[0].metadata.entry, resource.rootUrl).href);
            return module.default;
          })()`);
        },
        { url: host.remoteUrl, dlcId: REMOTE_DLC_ID },
      );
      expect(value).toBe("loaded-from-remote-host");
    });
  });
