import type { Notification } from "@edenapp/types";
import { PermissionRegistry } from "../../../src/ipc/PermissionRegistry";
import { PackageRegistry } from "../../../src/package-manager/PackageRegistry";
import { ProcessManager } from "../../../src/process-manager/ProcessManager";
import { ViewManager } from "../../../src/view-manager/ViewManager";
import { testApp } from "../../support/apps";
import { createTestCaller } from "../../support/callers";
import { createTestEden } from "../../support/createTestEden";

it("delivers through real notification controllers only to the display and original source views", async () => {
  const eden = await createTestEden();
  try {
    const providerApp = "app.notification-display";
    const sourceApp = "app.notification-source";
    const observerApp = "app.notification-observer";
    const { user } = await createTestCaller(eden, providerApp, [
      "notification/display",
    ]);
    await eden.runtime.sessions.login(user.username, "password");
    const packages = eden.runtime.resolve(PackageRegistry);
    const permissions = eden.runtime.resolve(PermissionRegistry);
    const processes = eden.runtime.resolve(ProcessManager);
    const views = eden.runtime.resolve(ViewManager);
    const messages = new Map<
      number,
      Array<{ type: string; payload: unknown }>
    >();
    const contentsByApp = new Map<string, number>();
    const invoke = async <T>(
      contentsId: number,
      command: string,
      args: unknown = {},
    ) => {
      const response = (await eden.platform.rendererIpc.invoke(
        "shell-command",
        contentsId,
        command,
        args,
      )) as { mode: "result"; result: T };
      return response.result;
    };
    for (const appId of [providerApp, sourceApp, observerApp]) {
      packages.register(testApp(appId));
      permissions.registerApp(
        appId,
        appId === providerApp ? ["notification/display"] : [],
      );
      await eden.complete("process/launch", { appId });
      const contents = views.getViewInfo(
        processes.getAppInstance(appId)!.viewId,
      )!.view.webContents;
      contentsByApp.set(appId, contents.id);
      const received: Array<{ type: string; payload: unknown }> = [];
      messages.set(contents.id, received);
      contents.on(
        "message-sent",
        (channel: string, message: { type: string; payload: unknown }) => {
          if (
            channel === "shell-message" &&
            message.type.startsWith("notification/")
          )
            received.push(message);
        },
      );
      for (const event of [
        "notification/added",
        "notification/action-clicked",
        "notification/removed",
      ])
        await invoke(contents.id, "event/subscribe", { eventName: event });
    }
    const provider = contentsByApp.get(providerApp)!;
    const source = contentsByApp.get(sourceApp)!;
    const observer = contentsByApp.get(observerApp)!;
    await invoke(provider, "notification/register-display");
    const notification = await invoke<Notification>(
      source,
      "notification/push",
      {
        title: "Saved",
        message: "Document saved",
        actions: [{ id: "open", label: "Open" }],
        _callerWebContentsId: provider,
      },
    );
    expect(messages.get(provider)).toEqual([
      { type: "notification/added", payload: { notification } },
    ]);
    expect(messages.get(source)).toEqual([]);
    expect(messages.get(observer)).toEqual([]);
    await expect(
      invoke(source, "notification/action-clicked", {
        notificationId: notification.id,
        actionId: "open",
        _callerAppId: providerApp,
        _callerWebContentsId: provider,
      }),
    ).rejects.toThrow("Permission denied");
    await invoke(provider, "notification/action-clicked", {
      notificationId: notification.id,
      actionId: "open",
    });
    await invoke(provider, "notification/dismissed", {
      notificationId: notification.id,
    });
    expect(messages.get(source)).toEqual([
      {
        type: "notification/action-clicked",
        payload: { notificationId: notification.id, actionId: "open" },
      },
      { type: "notification/removed", payload: { id: notification.id } },
    ]);
    expect(messages.get(provider)).toHaveLength(1);
    expect(messages.get(observer)).toEqual([]);

    const host = await eden.execute<Notification>("notification/push", {
      title: "Host",
      message: "Host message",
    });
    await invoke(provider, "notification/action-clicked", {
      notificationId: host.id,
      actionId: "details",
    });
    for (const received of messages.values())
      expect(received.at(-1)).toEqual({
        type: "notification/action-clicked",
        payload: { notificationId: host.id, actionId: "details" },
      });
  } finally {
    await eden.dispose();
  }
});
