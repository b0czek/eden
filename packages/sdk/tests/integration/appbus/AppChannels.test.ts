import type { ConnectResult } from "@edenapp/types";
import { PermissionRegistry } from "../../../src/ipc/PermissionRegistry";
import { PackageRegistry } from "../../../src/package-manager/PackageRegistry";
import { BackendManager } from "../../../src/process-manager/BackendManager";
import { ProcessManager } from "../../../src/process-manager/ProcessManager";
import { ViewManager } from "../../../src/view-manager/ViewManager";
import { testApp } from "../../support/apps";
import { createTestCaller } from "../../support/callers";
import { createTestEden, type TestEden } from "../../support/createTestEden";

async function scenario() {
  const eden = await createTestEden();
  const provider = "app.channel-provider";
  const client = "app.channel-client";
  const denied = "app.channel-denied";
  const { user } = await createTestCaller(eden, provider, ["appbus/expose"]);
  await eden.runtime.sessions.login(user.username, "password");
  const packages = eden.runtime.services.packageRegistry;
  const permissions = eden.runtime.services.permissions;
  const processes = eden.runtime.services.processes;
  const views = eden.runtime.services.views;
  const contents = new Map<string, number>();
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
    contents.set(
      appId,
      views.getViewInfo(processes.getAppInstance(appId)!.viewId)!.view
        .webContents.id,
    );
  }
  const invoke = async <A>(
    appId: string,
    command: string,
    args: unknown = {},
  ) => {
    const response = (await eden.platform.rendererIpc.invoke(
      "shell-command",
      contents.get(appId)!,
      command,
      args,
    )) as { mode: "result"; result: A };
    return response.result;
  };
  return {
    eden,
    provider,
    client,
    denied,
    packages,
    permissions,
    user,
    processes,
    views,
    contents,
    invoke,
  };
}

describe("AppBus command and process lifecycle integration", () => {
  let eden: TestEden | undefined;
  afterEach(async () => {
    await eden?.dispose();
  });

  it("uses authenticated renderer identities and removes registrations and peers when their provider stops", async () => {
    const s = await scenario();
    eden = s.eden;
    await expect(
      s.invoke(s.provider, "appbus/register", {
        serviceName: "documents",
        description: "Original",
        allowedClients: [s.client],
        _callerAppId: s.client,
        _callerWebContentsId: s.contents.get(s.client),
      }),
    ).resolves.toEqual({ success: true });
    await expect(
      s.invoke(s.provider, "appbus/register", {
        serviceName: "documents",
        description: "Replacement",
      }),
    ).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("already registered"),
    });
    await expect(
      s.invoke(s.client, "appbus/list-by-app", { appId: s.provider }),
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
      s.invoke(s.denied, "appbus/connect", {
        targetAppId: s.provider,
        serviceName: "documents",
      }),
    ).rejects.toThrow(/permission|denied/i);
    const connection = await s.invoke<ConnectResult>(
      s.client,
      "appbus/connect",
      { targetAppId: s.provider, serviceName: "documents" },
    );
    expect(connection.success).toBe(true);
    const stoppedConnections: unknown[] = [];
    const clientView = s.views.getViewInfo(
      s.processes.getAppInstance(s.client)!.viewId,
    )!;
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
      s.invoke(s.client, "appbus/list-by-app", { appId: s.provider }),
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
    const backendProcess =
      eden.runtime.services.backends.getBackend(backendAppId);
    if (!backendProcess?.pid) throw new Error("Backend did not start");
    eden.platform.utilityProcesses
      .get(backendProcess.pid)!
      .emit("message", { type: "backend-ready" });
    await launching;
    await s.invoke(s.provider, "appbus/register", { serviceName: "documents" });
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
    const pid = eden.runtime.services.backends.getBackend(backendAppId)!.pid!;
    const backend = eden.platform.utilityProcesses.get(pid)!;
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
