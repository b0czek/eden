import "reflect-metadata";
import { defineController } from "../../../src/controllers/controller";
import {
  targetedEvent,
  routedEvent,
  type RoutedNotification,
  type TargetedNotification,
} from "../../../src/controllers/events";
import { createEvent } from "../../../src/events/event";
import { IPCBridge } from "../../../src/ipc/IPCBridge";
import { PackageRegistry } from "../../../src/package-manager/PackageRegistry";
import { ProcessManager } from "../../../src/process-manager/ProcessManager";
import { ViewManager } from "../../../src/view-manager/ViewManager";
import { testApp } from "../../support/apps";
import { createTestCaller } from "../../support/callers";
import { createTestEden } from "../../support/createTestEden";

it("delivers a controller notification only to selected subscribed views and releases forwarding on shutdown", async () => {
  const eden = await createTestEden();
  const source = createEvent<TargetedNotification<{ value: string }>>();
  const mixed = createEvent<RoutedNotification<{ value: string }>>();
  try {
    const registry = eden.runtime.resolve(PackageRegistry);
    const ids = ["com.example.first", "com.example.second"];
    for (const id of ids) registry.register(testApp(id));
    const { user } = await createTestCaller(eden, ids[0], []);
    await eden.runtime.sessions.login(user.username, "password");
    const views = eden.runtime.resolve(ViewManager);
    const bridge = eden.runtime.resolve(IPCBridge);
    bridge.registerController(
      defineController("routing", {
        commands: {},
        events: { changed: targetedEvent(source), notice: routedEvent(mixed) },
      }),
    );
    const recipients: Array<{ viewId: number; contentsId: number }> = [];
    for (const appId of ids) {
      await eden.complete("process/launch", { appId });
      const viewId = eden.runtime
        .resolve(ProcessManager)
        .getAppInstance(appId)!.viewId;
      recipients.push({
        viewId,
        contentsId: views.getViewInfo(viewId)!.view.webContents.id,
      });
      expect(bridge.eventSubscribers.subscribe(viewId, "routing/changed")).toBe(
        true,
      );
      expect(bridge.eventSubscribers.subscribe(viewId, "routing/notice")).toBe(
        true,
      );
    }
    const received = (eventName = "routing/changed") =>
      eden.platform.effects.flatMap((effect) => {
        if (
          effect.type !== "message-sent" ||
          effect.channel !== "shell-message"
        )
          return [];
        const message = effect.args[0] as { type: string; payload: unknown };
        return message.type === eventName
          ? [{ contentsId: effect.webContentsId, payload: message.payload }]
          : [];
      });
    source.emit({
      payload: { value: "private" },
      viewIds: [recipients[0].viewId, recipients[0].viewId],
    });
    source.emit({ payload: { value: "nobody" }, viewIds: [] });
    expect(received()).toEqual([
      { contentsId: recipients[0].contentsId, payload: { value: "private" } },
    ]);
    mixed.emit({ payload: { value: "broadcast" } });
    mixed.emit({
      payload: { value: "selected" },
      viewIds: [recipients[1].viewId],
    });
    mixed.emit({ payload: { value: "empty" }, viewIds: [] });
    expect(received("routing/notice")).toEqual([
      { contentsId: recipients[0].contentsId, payload: { value: "broadcast" } },
      { contentsId: recipients[1].contentsId, payload: { value: "broadcast" } },
      { contentsId: recipients[1].contentsId, payload: { value: "selected" } },
    ]);
    await eden.dispose();
    mixed.emit({ payload: { value: "after shutdown" } });
    expect(received("routing/notice")).toHaveLength(3);
    source.emit({
      payload: { value: "after shutdown" },
      viewIds: [recipients[1].viewId],
    });
    expect(received()).toHaveLength(1);
  } finally {
    source.dispose();
    mixed.dispose();
    await eden.dispose();
  }
});
