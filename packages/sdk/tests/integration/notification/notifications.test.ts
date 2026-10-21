import type { Notification } from "@edenapp/types";
import { testApp } from "../../support/apps";
import { createTestCaller } from "../../support/callers";
import { createTestEden } from "../../support/create-test-eden";

it("delivers through real notification controllers only to the display and original source views", async () => {
  const eden = await createTestEden();
  try {
    const providerApp = "app.notification-display";
    const sourceApp = "app.notification-source";
    const observerApp = "app.notification-observer";
    const { user } = await createTestCaller(eden, providerApp, [
      "notification/display",
    ]);
    await eden.runtime.effects.run(
      eden.runtime.sessions.login(user.username, "password"),
    );
    const packages = eden.runtime.services.installedPackages;
    const permissions = eden.runtime.services.permissions;
    const messages = new Map<
      number,
      Array<{ type: string; payload: unknown }>
    >();
    for (const appId of [providerApp, sourceApp, observerApp]) {
      packages.register(testApp(appId));
      permissions.registerApp(
        appId,
        appId === providerApp ? ["notification/display"] : [],
      );
      await eden.complete("process/launch", { appId });
      const contents = eden.getAppView(appId).view.webContents;
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
        await eden.executeFromView(contents.id, "event/subscribe", {
          eventName: event,
        });
    }
    const provider = eden.getAppView(providerApp).view.webContents.id;
    const source = eden.getAppView(sourceApp).view.webContents.id;
    const observer = eden.getAppView(observerApp).view.webContents.id;
    await eden.executeFromView(provider, "notification/register-display");
    const notification = await eden.executeFromView<Notification>(
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
      eden.executeFromView(source, "notification/action-clicked", {
        notificationId: notification.id,
        actionId: "open",
        _callerAppId: providerApp,
        _callerWebContentsId: provider,
      }),
    ).rejects.toThrow("Permission denied");
    await eden.executeFromView(provider, "notification/action-clicked", {
      notificationId: notification.id,
      actionId: "open",
    });
    await eden.executeFromView(provider, "notification/dismissed", {
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
    await eden.executeFromView(provider, "notification/action-clicked", {
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
