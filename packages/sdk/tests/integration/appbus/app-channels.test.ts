import type { ConnectResult } from "@edenapp/types";
import { testApp } from "../../support/apps";
import { gate, tick } from "../../support/async";
import { createTestCaller } from "../../support/callers";
import { createTestEden, type TestEden } from "../../support/create-test-eden";

async function scenario() {
  const eden = await createTestEden();
  const provider = "app.channel-provider";
  const client = "app.channel-client";
  const denied = "app.channel-denied";
  const { user } = await createTestCaller(eden, provider, ["appbus/expose"]);
  await eden.runtime.effects.run(
    eden.runtime.sessions.login(user.username, "password"),
  );
  const packages = eden.runtime.services.installedPackages;
  const permissions = eden.runtime.services.permissions;
  for (const appId of [provider, client, denied]) {
    packages.register(testApp(appId));
    permissions.registerApp(
      appId,
      appId === provider
        ? ["appbus/expose"]
        : appId === client
          ? ["appbus/connect"]
          : [],
    );
    await eden.complete("process/launch", { appId });
  }
  return {
    eden,
    provider,
    client,
    denied,
    packages,
    permissions,
    user,
    contents: {
      provider: eden.getAppView(provider).view.webContents.id,
      client: eden.getAppView(client).view.webContents.id,
      denied: eden.getAppView(denied).view.webContents.id,
    },
  };
}

describe("AppBus command and process lifecycle integration", () => {
  let eden: TestEden | undefined;
  afterEach(async () => {
    jest.restoreAllMocks();
    await eden?.dispose();
  });

  it("withdraws services before a provider backend receives shutdown", async () => {
    const s = await scenario();
    eden = s.eden;
    const provider = "app.stopping-provider";
    s.packages.register(
      testApp(provider, { backend: { entry: "backend.js" } }),
    );
    s.permissions.registerApp(provider, ["appbus/expose"]);
    const launching = eden.complete("process/launch", { appId: provider });
    await tick();
    const backend = eden.getBackendProcess(provider);
    backend.emit("message", { type: "backend-ready" });
    await launching;
    await expect(
      eden.execute(
        "appbus/register",
        { serviceName: "documents" },
        { appId: provider, principal: { kind: "user", profile: s.user } },
      ),
    ).resolves.toEqual({ success: true });
    const shutdown = gate();
    const postMessage = backend.postMessage.bind(backend);
    jest.spyOn(backend, "postMessage").mockImplementation((message) => {
      postMessage(message);
      if ((message as { type?: string }).type === "shutdown")
        shutdown.release();
    });
    const stopping = eden.complete("process/stop", { appId: provider });
    try {
      await shutdown.promise;
      await expect(eden.execute("appbus/list")).resolves.toEqual({
        services: [],
      });
      await expect(
        eden.executeFromView(s.contents.client, "appbus/connect", {
          targetAppId: provider,
          serviceName: "documents",
        }),
      ).resolves.toMatchObject({
        success: false,
        error: expect.stringContaining("not found"),
      });
    } finally {
      backend.kill();
      await stopping;
    }
  });

  it("uses authenticated renderer identities and removes registrations and peers when their provider stops", async () => {
    const s = await scenario();
    eden = s.eden;
    await expect(
      eden.executeFromView(s.contents.provider, "appbus/register", {
        serviceName: "documents",
        description: "Original",
        allowedClients: [s.client],
        _callerAppId: s.client,
        _callerWebContentsId: s.contents.client,
      }),
    ).resolves.toEqual({ success: true });
    await expect(
      eden.executeFromView(s.contents.provider, "appbus/register", {
        serviceName: "documents",
        description: "Replacement",
      }),
    ).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("already registered"),
    });
    await expect(
      eden.executeFromView(s.contents.client, "appbus/list-by-app", {
        appId: s.provider,
      }),
    ).resolves.toEqual({
      services: [
        {
          appId: s.provider,
          serviceName: "documents",
          description: "Original",
        },
      ],
    });
    await expect(
      eden.executeFromView(s.contents.denied, "appbus/connect", {
        targetAppId: s.provider,
        serviceName: "documents",
      }),
    ).rejects.toThrow(/permission|denied/i);
    const connection = await eden.executeFromView<ConnectResult>(
      s.contents.client,
      "appbus/connect",
      { targetAppId: s.provider, serviceName: "documents" },
    );
    expect(connection.success).toBe(true);
    const stoppedConnections: unknown[] = [];
    const clientView = eden.getAppView(s.client);
    clientView.view.webContents.on(
      "message-sent",
      (channel: string, payload: unknown) => {
        if (channel === "appbus-port-closed") stoppedConnections.push(payload);
      },
    );
    await eden.complete("process/stop", { appId: s.provider });
    expect(stoppedConnections).toEqual([
      { connectionId: connection.connectionId },
    ]);
    await expect(
      eden.executeFromView(s.contents.client, "appbus/list-by-app", {
        appId: s.provider,
      }),
    ).resolves.toEqual({ services: [] });
  });

  it("notifies backend clients without a renderer identity when the connected provider stops", async () => {
    const s = await scenario();
    eden = s.eden;
    const backendAppId = "app.channel-backend";
    s.packages.register(
      testApp(backendAppId, {
        frontend: undefined,
        backend: { entry: "backend.js" },
      }),
    );
    s.permissions.registerApp(backendAppId, ["appbus/connect"]);
    const launching = eden.complete("process/launch", { appId: backendAppId });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const backend = eden.getBackendProcess(backendAppId);
    backend.emit("message", { type: "backend-ready" });
    await launching;
    await eden.executeFromView(s.contents.provider, "appbus/register", {
      serviceName: "documents",
    });
    const connection = await eden.execute<ConnectResult>(
      "appbus/connect",
      {
        targetAppId: s.provider,
        serviceName: "documents",
        _callerAppId: s.denied,
      },
      { appId: backendAppId, principal: { kind: "user", profile: s.user } },
    );
    expect(connection.success).toBe(true);
    expect(backend.messages).toContainEqual({
      type: "appbus-port",
      connectionId: connection.connectionId,
      targetAppId: s.provider,
      serviceName: "documents",
      role: "client",
    });
    await eden.complete("process/stop", { appId: s.provider });
    expect(backend.messages).toContainEqual({
      type: "appbus-port-closed",
      connectionId: connection.connectionId,
    });
  });
});
