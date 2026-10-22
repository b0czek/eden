import { testApp } from "../../support/apps";
import { tick } from "../../support/async";
import { createTestEden } from "../../support/create-test-eden";

it("delivers setting values only to live authorized renderer and backend readers", async () => {
  const eden = await createTestEden();
  try {
    const owner = testApp("app.owner", {
      permissions: ["settings/rw"],
      settings: [
        {
          id: "private",
          name: "Private",
          settings: [
            { key: "token", label: "Token", type: "text" },
            {
              key: "shared",
              label: "Shared",
              type: "text",
              sharedWith: ["app.reader", "app.no-permission"],
            },
          ],
        },
      ],
    });
    const reader = testApp("app.reader", {
      backend: { entry: "backend.js" },
    });
    const apps = [
      owner,
      reader,
      testApp("app.outsider", { permissions: ["settings/rw"] }),
      testApp("app.admin", { permissions: ["settings/superuser"] }),
      testApp("app.no-permission"),
    ];
    const { installedPackages, sessionContext, settings } =
      eden.runtime.services;
    for (const app of apps) {
      installedPackages.register({
        ...app,
        window: {
          mode: "floating",
          injections: { css: "none", appFrame: "none" },
        },
      });
      eden.runtime.services.permissions.registerApp(
        app.id,
        app.permissions,
        app.id === reader.id
          ? [
              {
                scope: "app",
                id: "read-settings",
                label: "Read settings",
                permissions: ["settings/rw"],
              },
            ]
          : undefined,
      );
    }
    const user = await eden.runtime.effects.run(
      eden.runtime.users.create({
        username: "observer",
        name: "Observer",
        password: "password",
        grants: [
          "apps/launch/*",
          "app/app.reader/read-settings",
          "settings/app.owner/shared",
          "settings/app.owner/token",
        ],
      }),
    );
    await eden.runtime.effects.run(
      eden.runtime.sessions.login(user.username, "password"),
    );
    for (const app of apps) {
      const launching = eden.complete("process/launch", { appId: app.id });
      if (app.backend) {
        await tick();
        eden
          .getBackendProcess(app.id)
          .emit("message", { type: "backend-ready" });
      }
      await launching;
      await eden.executeFromView(
        eden.getAppView(app.id).view.webContents.id,
        "event/subscribe",
        { eventName: "settings/changed" },
      );
    }
    const contentsId = (appId: string) =>
      eden.getAppView(appId).view.webContents.id;
    const backend = eden.getBackendProcess(reader.id);
    await eden.execute(
      "event/subscribe",
      { eventName: "settings/changed" },
      {
        appId: reader.id,
        sessionId: sessionContext.getSessionId(),
        principal: { kind: "user", profile: user },
      },
    );
    const recipients = (value: string) =>
      eden.platform.effects.flatMap((effect) => {
        if (
          effect.type !== "message-sent" ||
          effect.channel !== "shell-message"
        )
          return [];
        const message = effect.args[0] as {
          type: string;
          payload: { value: string };
        };
        return message.type === "settings/changed" &&
          message.payload.value === value
          ? [effect.webContentsId]
          : [];
      });
    const backendValues = () =>
      backend.messages.flatMap((message) => {
        const event = message as {
          type: string;
          eventName: string;
          payload: { value: string };
        };
        return event.type === "shell-event" &&
          event.eventName === "settings/changed"
          ? [event.payload.value]
          : [];
      });
    await expect(
      eden.executeFromView(contentsId(reader.id), "settings/get", {
        appId: owner.id,
        key: "token",
      }),
    ).rejects.toThrow("Caller is not allowed to read this setting");
    await eden.runtime.effects.run(
      settings.set(owner.id, "token", "PRIVATE_TOKEN"),
    );
    expect(recipients("PRIVATE_TOKEN")).toEqual([
      contentsId(owner.id),
      contentsId("app.admin"),
    ]);
    expect(backendValues()).toEqual([]);
    await expect(
      eden.executeFromView(contentsId("app.admin"), "settings/get/su", {
        appId: owner.id,
        key: "token",
      }),
    ).resolves.toEqual({ value: "PRIVATE_TOKEN" });

    await expect(
      eden.executeFromView(contentsId(reader.id), "settings/get", {
        appId: owner.id,
        key: "shared",
      }),
    ).resolves.toEqual({ value: undefined });
    await eden.runtime.effects.run(
      settings.set(owner.id, "shared", "SHARED_VALUE"),
    );
    expect(recipients("SHARED_VALUE")).toEqual([
      contentsId(owner.id),
      contentsId(reader.id),
      contentsId("app.admin"),
    ]);
    expect(backendValues()).toEqual(["SHARED_VALUE"]);

    await eden.runtime.effects.run(
      eden.runtime.users.update({
        username: user.username,
        grants: ["apps/launch/*", "settings/app.owner/*"],
      }),
    );
    await expect(
      eden.executeFromView(contentsId(reader.id), "settings/get", {
        appId: owner.id,
        key: "shared",
      }),
    ).rejects.toThrow("Grant denied");
    await eden.runtime.effects.run(
      settings.set(owner.id, "shared", "AFTER_PERMISSION_REVOCATION"),
    );
    expect(recipients("AFTER_PERMISSION_REVOCATION")).toEqual([
      contentsId(owner.id),
      contentsId("app.admin"),
    ]);
    expect(backendValues()).toEqual(["SHARED_VALUE"]);

    await eden.runtime.effects.run(
      eden.runtime.users.update({
        username: user.username,
        grants: ["apps/launch/*", "app/app.reader/read-settings"],
      }),
    );
    await expect(
      eden.executeFromView(contentsId(reader.id), "settings/get", {
        appId: owner.id,
        key: "shared",
      }),
    ).rejects.toThrow("does not have grant");
    await eden.runtime.effects.run(
      settings.set(owner.id, "shared", "AFTER_REVOCATION"),
    );
    expect(recipients("AFTER_REVOCATION")).toEqual([contentsId(owner.id)]);
    expect(backendValues()).toEqual(["SHARED_VALUE"]);
    await expect(
      eden.executeFromView(contentsId(owner.id), "settings/get", {
        key: "shared",
      }),
    ).resolves.toEqual({ value: "AFTER_REVOCATION" });
    await expect(
      eden.executeFromView(contentsId("app.admin"), "settings/get/su", {
        appId: owner.id,
        key: "shared",
      }),
    ).rejects.toThrow("does not have grant");
  } finally {
    await eden.dispose();
  }
});
