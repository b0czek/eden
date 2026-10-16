import "reflect-metadata";
import type {
  FilePickerOpenEvent,
  FilePickerResult,
  Notification,
} from "@edenapp/types";
import { IPCBridge } from "../../../src/ipc/IPCBridge";
import { PackageRegistry } from "../../../src/package-manager/PackageRegistry";
import { ProcessManager } from "../../../src/process-manager/ProcessManager";
import { ViewManager } from "../../../src/view-manager/ViewManager";
import { testApp } from "../../support/apps";
import { createTestCaller } from "../../support/callers";
import { createTestEden } from "../../support/createTestEden";

it("executes a native notification action to replace the busy file picker across services", async () => {
  const eden = await createTestEden();
  try {
    const providerId = "com.example.displays";
    const firstId = "com.example.first-opener";
    const secondId = "com.example.second-opener";
    const registry = eden.runtime.resolve(PackageRegistry);
    for (const id of [providerId, firstId, secondId])
      registry.register(
        testApp(id, {
          permissions:
            id === providerId
              ? ["notification/display", "file-picker/display"]
              : [],
        }),
      );
    const { user, caller } = await createTestCaller(eden, providerId, [
      "notification/display",
      "file-picker/display",
    ]);
    await eden.runtime.sessions.login(user.username, "password");
    const processes = eden.runtime.resolve(ProcessManager);
    const views = eden.runtime.resolve(ViewManager);
    const subscribers = eden.runtime.resolve(IPCBridge).eventSubscribers;
    async function launch(appId: string) {
      await eden.complete("process/launch", { appId });
      const viewId = processes.getAppInstance(appId)!.viewId;
      const webContentsId = views.getViewInfo(viewId)!.view.webContents.id;
      return { viewId, caller: { ...caller, appId, webContentsId } };
    }
    const provider = await launch(providerId);
    const first = await launch(firstId);
    const second = await launch(secondId);
    subscribers.subscribe(provider.viewId, "notification/added");
    subscribers.subscribe(first.viewId, "file-picker/closed");
    subscribers.subscribe(second.viewId, "file-picker/opened");
    const events = <T>(type: string, contentsId: number): T[] =>
      eden.platform.effects.flatMap((effect) => {
        if (
          effect.type !== "message-sent" ||
          effect.channel !== "shell-message" ||
          effect.webContentsId !== contentsId
        )
          return [];
        const message = effect.args[0] as { type: string; payload: T };
        return message.type === type ? [message.payload] : [];
      });
    await eden.execute("notification/register-display", {}, provider.caller);
    await eden.execute("file-picker/register-display", {}, provider.caller);
    const opened = await eden.execute<{ requestId: string }>(
      "file-picker/open",
      { mode: "open" },
      first.caller,
    );
    await expect(
      eden.execute(
        "file-picker/open",
        { mode: "save", suggestedName: "report.txt" },
        second.caller,
      ),
    ).rejects.toThrow("File picker is busy");
    const [{ notification }] = events<{ notification: Notification }>(
      "notification/added",
      provider.caller.webContentsId,
    );
    expect(notification.actions).toEqual([
      { id: "force-open-file-picker", label: "Force open" },
    ]);
    expect(events("file-picker/opened", second.caller.webContentsId)).toEqual(
      [],
    );
    await expect(
      eden.execute(
        "notification/action-clicked",
        { notificationId: notification.id, actionId: "force-open-file-picker" },
        provider.caller,
      ),
    ).resolves.toEqual({ success: true });
    expect(
      events<FilePickerResult>(
        "file-picker/closed",
        first.caller.webContentsId,
      ),
    ).toEqual([{ requestId: opened.requestId, reason: "close" }]);
    expect(
      events<{ picker: FilePickerOpenEvent }>(
        "file-picker/opened",
        second.caller.webContentsId,
      ),
    ).toEqual([
      {
        picker: expect.objectContaining({
          mode: "save",
          suggestedName: "report.txt",
          opener: expect.objectContaining({
            appId: secondId,
            viewId: second.viewId,
          }),
        }),
      },
    ]);
  } finally {
    await eden.dispose();
  }
});
