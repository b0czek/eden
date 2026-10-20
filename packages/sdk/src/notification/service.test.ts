import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import {
  buildService,
  createEffectRuntime,
} from "../../tests/support/effect-runtime";
import { fromPromise } from "../effects/io";
import { NotificationCallerRejected, NotificationsClosed } from "./errors";
import { NotificationViews } from "./ports";
import { Notifications, NotificationsLive } from "./service";

const provider = { appId: "app.toaster", webContentsId: 100 };
const editor = { appId: "app.editor", webContentsId: 200 };

async function scenario() {
  const runtime = createEffectRuntime();
  const liveViews = new Set([10, 20]);
  const views = {
    resolve: (id?: number) => (id === 100 ? 10 : id === 200 ? 20 : undefined),
    isAlive: (id: number) => liveViews.has(id),
  };
  const notifications = await runtime.acquire(
    buildService(Notifications, NotificationsLive).pipe(
      Effect.provideService(NotificationViews, views),
    ),
  );
  notifications.registerDisplayProvider(provider);
  return { runtime, notifications, liveViews, views };
}

it("creates notification data and display delivery only when the Effect executes", async () => {
  const { runtime, notifications } = await scenario();
  try {
    const delivered: unknown[] = [];
    notifications.added.on((event) => {
      delivered.push(event);
    });
    const pending = notifications.pushNotification(
      "Title",
      "Message",
      0,
      "info",
      [{ id: "open", label: "Open" }],
    );
    expect(delivered).toEqual([]);
    const notification = await runtime.run(pending);
    expect(notification).toMatchObject({
      title: "Title",
      message: "Message",
      type: "info",
      actions: [{ id: "open", label: "Open" }],
    });
    expect(notification.timeout).toBeUndefined();
    expect(delivered).toEqual([{ payload: { notification }, viewIds: [10] }]);
  } finally {
    await runtime.dispose();
  }
});

it("composes native action callbacks and consumes them only after success", async () => {
  const { runtime, notifications } = await scenario();
  try {
    let attempts = 0;
    const failure = new Error("Action unavailable");
    const routed: unknown[] = [];
    notifications.actionClicked.on((event) => {
      routed.push(event);
    });
    const notification = await runtime.run(
      notifications.pushNotification(
        "Title",
        "Message",
        0,
        "warning",
        [{ id: "force", label: "Force open" }],
        {
          force: (value) =>
            Effect.suspend(() => {
              expect(value.id).toBe(notification.id);
              attempts++;
              return attempts === 1 ? Effect.fail(failure) : Effect.void;
            }),
        },
      ),
    );
    const action = notifications.handleActionClicked(
      notification.id,
      "force",
      provider,
    );
    await expect(runtime.run(action)).rejects.toBe(failure);
    await expect(runtime.run(action)).resolves.toEqual({ success: true });
    expect(attempts).toBe(2);
    expect(routed).toEqual([]);
    await runtime.run(action);
    expect(attempts).toBe(2);
    expect(routed).toEqual([
      {
        payload: { notificationId: notification.id, actionId: "force" },
        viewIds: undefined,
      },
    ]);
  } finally {
    await runtime.dispose();
  }
});

it("routes renderer actions and dismissals to the source and discards dismissed callbacks", async () => {
  const { runtime, notifications } = await scenario();
  try {
    const actions: unknown[] = [];
    const removals: unknown[] = [];
    let callbackRuns = 0;
    notifications.actionClicked.on((event) => {
      actions.push(event);
    });
    notifications.removed.on((event) => {
      removals.push(event);
    });
    const notification = await runtime.run(
      notifications.pushNotification(
        "Title",
        "Message",
        5000,
        "info",
        [{ id: "details", label: "Details" }],
        {
          force: () =>
            Effect.sync(() => {
              callbackRuns++;
            }),
        },
        editor,
      ),
    );
    await runtime.run(
      notifications.handleActionClicked(notification.id, "details", provider),
    );
    expect(actions).toEqual([
      {
        payload: { notificationId: notification.id, actionId: "details" },
        viewIds: [20],
      },
    ]);
    expect(notifications.handleDismissed(notification.id, provider)).toEqual({
      success: true,
    });
    expect(removals).toEqual([
      { payload: { id: notification.id }, viewIds: [20] },
    ]);
    await runtime.run(
      notifications.handleActionClicked(notification.id, "force", provider),
    );
    expect(callbackRuns).toBe(0);
    expect(notifications.handleDismissed(notification.id, provider)).toEqual({
      success: false,
    });
    expect(removals).toHaveLength(1);
  } finally {
    await runtime.dispose();
  }
});

it("rejects actions and dismissals from another view or a dead display provider", async () => {
  const { runtime, notifications, liveViews } = await scenario();
  try {
    const notification = await runtime.run(
      notifications.pushNotification("Title", "Message"),
    );
    await expect(
      runtime.run(
        notifications.handleActionClicked(notification.id, "open", editor),
      ),
    ).rejects.toMatchObject({
      _tag: "NotificationCallerRejected",
      operation: "actions",
      appId: editor.appId,
      webContentsId: editor.webContentsId,
      message: "Only the notification display provider can report actions",
    });
    expect(() =>
      notifications.handleDismissed(notification.id, editor),
    ).toThrow(NotificationCallerRejected);
    liveViews.delete(10);
    await expect(
      runtime.run(
        notifications.handleActionClicked(notification.id, "open", provider),
      ),
    ).rejects.toThrow("Only the notification display provider");
    expect(() =>
      notifications.handleDismissed(notification.id, provider),
    ).toThrow("Only the notification display provider");
  } finally {
    await runtime.dispose();
  }
});

it("settles native action I/O before disposing its service scope", async () => {
  const { runtime, notifications } = await scenario();
  let finish!: () => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const accepted = new Promise<void>((resolve) => {
    started = resolve;
  });
  let completed = false;
  try {
    notifications.added.on(() => {});
    const notification = await runtime.run(
      notifications.pushNotification("Title", "Message", 0, "info", undefined, {
        work: () =>
          fromPromise(async () => {
            started();
            await pending;
            completed = true;
          }),
      }),
    );
    const action = runtime.run(
      notifications.handleActionClicked(notification.id, "work", provider),
    );
    await accepted;
    const disposal = runtime.dispose();
    expect(completed).toBe(false);
    finish();
    const settled = await Promise.allSettled([action, disposal]);
    expect(settled[1].status).toBe("fulfilled");
    expect(completed).toBe(true);
    expect(notifications.added.hasListeners()).toBe(false);
  } finally {
    finish();
    await runtime.dispose();
  }
});

it("rejects invalid registration and use after disposal without accepting notifications", async () => {
  const { runtime, notifications } = await scenario();
  try {
    expect(() =>
      notifications.registerDisplayProvider({ appId: "missing" }),
    ).toThrow(NotificationCallerRejected);
    const pending = notifications.pushNotification("Title", "Message");
    await runtime.dispose();
    expect(() => notifications.registerDisplayProvider(provider)).toThrow(
      NotificationsClosed,
    );
    expect(() => notifications.handleDismissed("missing", provider)).toThrow(
      NotificationsClosed,
    );
    await expect(Effect.runPromise(pending)).rejects.toThrow(
      "Notifications disposed",
    );
    await expect(
      Effect.runPromise(
        notifications.handleActionClicked("missing", "open", provider),
      ),
    ).rejects.toThrow("Notifications disposed");
  } finally {
    await runtime.dispose();
  }
});

it("keeps unexpected view adapter exceptions out of the recoverable failure channel", async () => {
  const { runtime, notifications, views } = await scenario();
  const defect = new Error("Broken view registry invariant");
  views.isAlive = () => {
    throw defect;
  };
  try {
    const exit = await runtime.run(
      Effect.exit(notifications.pushNotification("Title", "Message")),
    );
    expect(exit).toEqual(Exit.die(defect));
  } finally {
    await runtime.dispose();
  }
});

it("interrupts a native callback when its service scope closes independently of its caller", async () => {
  const scope = Scope.makeUnsafe();
  const notifications = await Effect.runPromise(
    Scope.provide(
      buildService(Notifications, NotificationsLive).pipe(
        Effect.provideService(NotificationViews, {
          resolve: () => 10,
          isAlive: () => true,
        }),
      ),
      scope,
    ),
  );
  let accepted!: () => void;
  const started = new Promise<void>((resolve) => {
    accepted = resolve;
  });
  let cleanedUp = false;
  try {
    notifications.registerDisplayProvider(provider);
    const notification = await Effect.runPromise(
      notifications.pushNotification("Title", "Message", 0, "info", undefined, {
        work: () =>
          Effect.andThen(Effect.sync(accepted), Effect.never).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                cleanedUp = true;
              }),
            ),
          ),
      }),
    );
    const action = Effect.runPromiseExit(
      notifications.handleActionClicked(notification.id, "work", provider),
    );
    await started;
    await Effect.runPromise(Scope.close(scope, Exit.void));
    expect(Exit.isFailure(await action)).toBe(true);
    expect(cleanedUp).toBe(true);
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.void));
  }
});
