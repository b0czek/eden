import * as path from "node:path";
import { expect, test } from "@playwright/test";
import { useElectronHost } from "./support/host";

const PROVIDER = "com.eden.integration.appbus.provider";
const CLIENT = "com.eden.integration.appbus.client";
const DENIED = "com.eden.integration.appbus.denied";

test.describe
  .serial("AppBus through Electron", () => {
    const getHost = useElectronHost({
      launchFixture: false,
      additionalAppsDirectory: path.join(__dirname, "fixtures/appbus"),
    });
    function request(service: string, payload: unknown, method = "echo") {
      return getHost().evaluateApp(
        CLIENT,
        `(async () => {
        const peer = await window.appBus.connect(${JSON.stringify(PROVIDER)}, ${JSON.stringify(service)});
        if ("error" in peer) throw new Error(peer.error);
        try { return await peer.request(${JSON.stringify(method)}, ${JSON.stringify(payload)}); }
        finally { peer.close(); }
      })()`,
      );
    }

    test.beforeAll(async () => {
      const host = getHost();
      for (const appId of [PROVIDER, CLIENT, DENIED]) {
        await host.executeHostCommand("process/launch", { appId });
        await expect
          .poll(() => host.evaluateApp(appId, "typeof window.appBus"))
          .toBe("object");
      }
      await expect
        .poll(() =>
          host.evaluateApp(
            CLIENT,
            `(async () => {
      const { services } = await window.appBus.listServicesByApp(${JSON.stringify(PROVIDER)});
      return services.map(service => service.serviceName).sort();
    })()`,
          ),
        )
        .toEqual(["backend", "frontend", "restricted"]);
    });

    test("transfers ports between apps for renderer and backend requests, preserving a service after rejected duplicate exposure", async () => {
      const host = getHost();
      expect(
        await host.evaluateApp(
          PROVIDER,
          `window.appBus.exposeService("frontend", connection => {
      connection.handle("echo", () => "replacement");
    })`,
        ),
      ).toMatchObject({ success: false });
      expect(
        await host.evaluateApp(
          CLIENT,
          `window.appBus.exposeService("reverse", (connection, client) => {
      connection.handle("echo", payload => ({ payload, client: client.appId, provider: "client" }));
    })`,
        ),
      ).toEqual({ success: true });
      for (const service of ["frontend", "backend"]) {
        expect(await request(service, { value: 42 })).toEqual({
          payload: { value: 42 },
          client: CLIENT,
          provider: service,
        });
      }
      expect(
        await request("backend", "backend to renderer", "roundtrip"),
      ).toEqual({
        payload: "backend to renderer",
        client: PROVIDER,
        provider: "client",
      });
    });

    test("rejects clients outside the service allowlist and apps without connect permission", async () => {
      const host = getHost();
      expect(
        await host.evaluateApp(
          CLIENT,
          `window.appBus.connect(${JSON.stringify(PROVIDER)}, "restricted")`,
        ),
      ).toMatchObject({ error: expect.stringContaining("not allowed") });
      expect(
        await host.evaluateApp(
          DENIED,
          `(async () => {
      try { return await window.appBus.connect(${JSON.stringify(PROVIDER)}, "frontend"); }
      catch (error) { return { error: String(error) }; }
    })()`,
        ),
      ).toMatchObject({ error: expect.stringMatching(/permission|denied/i) });
      // Rejections leave the allowed service usable.
      expect(await request("backend", "allowed")).toEqual({
        payload: "allowed",
        client: CLIENT,
        provider: "backend",
      });
    });

    test("removes stopped providers, closes client connections, and accepts fresh connections after restart", async () => {
      const host = getHost();
      expect(
        await host.evaluateApp(
          CLIENT,
          `(async () => {
      window.appBusPeers = [];
      window.appBusClosed = 0;
      for (const service of ["frontend", "backend"]) {
        const peer = await window.appBus.connect(${JSON.stringify(PROVIDER)}, service);
        if ("error" in peer) throw new Error(peer.error);
        peer.onClose(() => window.appBusClosed++);
        window.appBusPeers.push(peer);
      }
      return window.appBusPeers.every(peer => peer.isConnected());
    })()`,
        ),
      ).toBe(true);
      await host.executeHostCommand("process/stop", { appId: PROVIDER });
      await expect
        .poll(() =>
          host.evaluateApp(
            CLIENT,
            `({ closed: window.appBusClosed, connected: window.appBusPeers.some(peer => peer.isConnected()) })`,
          ),
        )
        .toEqual({ closed: 2, connected: false });
      expect(
        await host.evaluateApp(
          CLIENT,
          `window.appBus.listServicesByApp(${JSON.stringify(PROVIDER)})`,
        ),
      ).toEqual({ services: [] });
      expect(
        await host.evaluateApp(
          CLIENT,
          `window.appBus.connect(${JSON.stringify(PROVIDER)}, "backend")`,
        ),
      ).toMatchObject({ error: expect.stringContaining("not found") });
      await host.executeHostCommand("process/launch", { appId: PROVIDER });
      await expect
        .poll(() =>
          host.evaluateApp(
            CLIENT,
            `(async () => {
      const { services } = await window.appBus.listServicesByApp(${JSON.stringify(PROVIDER)});
      return services.length;
    })()`,
          ),
        )
        .toBe(3);
      for (const service of ["frontend", "backend"]) {
        expect(await request(service, "restarted")).toEqual({
          payload: "restarted",
          client: CLIENT,
          provider: service,
        });
      }
    });
  });
