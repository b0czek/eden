import type { Notification } from "@edenapp/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

type EventHandler = (payload: unknown) => void;

const createTransport = () => {
  const handlers = new Map<string, EventHandler>();
  let notificationCounter = 0;
  const shellCommand = vi.fn(async (_command: string, args: unknown) => ({
    ...(args as object),
    id: `notification-${++notificationCounter}`,
    createdAt: Date.now(),
  }));
  const subscribe = vi.fn(async (event: string, handler: EventHandler) => {
    handlers.set(event, handler);
  });

  vi.stubGlobal("window", { edenAPI: { shellCommand, subscribe } });
  return { handlers, shellCommand, subscribe };
};

const loadNotification = async () => {
  const module = await import("./notification");
  return module.notification;
};

describe("notification", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("supports actionless options without subscribing to events", async () => {
    const transport = createTransport();
    const notification = await loadNotification();

    await notification.push("Warning", "Mind the gap", {
      timeout: 10_000,
      type: "warning",
    });

    expect(transport.shellCommand).toHaveBeenCalledWith("notification/push", {
      title: "Warning",
      message: "Mind the gap",
      timeout: 10_000,
      type: "warning",
    });
    expect(transport.subscribe).not.toHaveBeenCalled();
  });

  it("generates action IDs and routes callbacks to their owning actions", async () => {
    const transport = createTransport();
    const firstAction = vi.fn();
    const secondAction = vi.fn();
    const notification = await loadNotification();

    await notification.push("First", "Message", [
      { label: "Open", onClick: firstAction },
    ]);
    await notification.push("Second", "Message", [
      { label: "Retry", onClick: secondAction },
    ]);

    const firstPayload = transport.shellCommand.mock.calls[0]?.[1] as {
      actions: Array<{ id: string }>;
    };
    const secondPayload = transport.shellCommand.mock.calls[1]?.[1] as {
      actions: Array<{ id: string }>;
    };
    expect(firstPayload.actions[0]?.id).not.toBe(secondPayload.actions[0]?.id);

    transport.handlers.get("notification/action-clicked")?.({
      notificationId: "notification-2",
      actionId: secondPayload.actions[0]?.id,
    });

    expect(firstAction).not.toHaveBeenCalled();
    expect(secondAction).toHaveBeenCalledOnce();
  });

  it("keeps non-dismissing actions active until notification removal", async () => {
    const transport = createTransport();
    const onClick = vi.fn();
    const notification = await loadNotification();

    const pushed = await notification.push("Progress", "Still working", [
      { label: "Refresh", onClick, dismissOnClick: false },
    ]);
    const payload = transport.shellCommand.mock.calls[0]?.[1] as {
      actions: Array<{ id: string }>;
    };
    const actionId = payload.actions[0]?.id;

    transport.handlers.get("notification/action-clicked")?.({
      notificationId: pushed.id,
      actionId,
    });
    transport.handlers.get("notification/action-clicked")?.({
      notificationId: pushed.id,
      actionId,
    });
    expect(onClick).toHaveBeenCalledTimes(2);

    transport.handlers.get("notification/removed")?.({ id: pushed.id });
    transport.handlers.get("notification/action-clicked")?.({
      notificationId: pushed.id,
      actionId,
    });
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("cleans up dismissing actions after their first click", async () => {
    const transport = createTransport();
    const onClick = vi.fn();
    const notification = await loadNotification();

    await notification.push("Question", "Continue?", [
      { label: "Continue", onClick },
    ]);
    const payload = transport.shellCommand.mock.calls[0]?.[1] as {
      actions: Array<{ id: string }>;
    };
    const event = {
      notificationId: "notification-1",
      actionId: payload.actions[0]?.id,
    };

    transport.handlers.get("notification/action-clicked")?.(event);
    transport.handlers.get("notification/action-clicked")?.(event);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("handles an action event before the push response resolves", async () => {
    const transport = createTransport();
    const onClick = vi.fn();
    transport.shellCommand.mockImplementationOnce(async (_command, args) => {
      const payload = args as { actions: Array<{ id: string }> };
      transport.handlers.get("notification/action-clicked")?.({
        notificationId: "notification-early",
        actionId: payload.actions[0]?.id,
      });
      return {
        ...(args as object),
        id: "notification-early",
        createdAt: Date.now(),
      };
    });
    const notification = await loadNotification();

    await notification.push("Question", "Continue?", [
      { label: "Continue", onClick },
    ]);

    expect(onClick).toHaveBeenCalledOnce();
    const payload = transport.shellCommand.mock.calls[0]?.[1] as {
      actions: Array<{ id: string }>;
    };
    transport.handlers.get("notification/action-clicked")?.({
      notificationId: "notification-early",
      actionId: payload.actions[0]?.id,
    });
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("cleans up routes when pushing fails", async () => {
    const transport = createTransport();
    const error = new Error("push failed");
    transport.shellCommand.mockRejectedValueOnce(error);
    const onClick = vi.fn();
    const notification = await loadNotification();

    await expect(
      notification.push("Question", "Continue?", [
        { label: "Continue", onClick },
      ]),
    ).rejects.toBe(error);
    const payload = transport.shellCommand.mock.calls[0]?.[1] as {
      actions: Array<{ id: string }>;
    };

    transport.handlers.get("notification/action-clicked")?.({
      notificationId: "missing",
      actionId: payload.actions[0]?.id,
    });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("logs and isolates synchronous and asynchronous callback errors", async () => {
    const transport = createTransport();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const notification = await loadNotification();

    const pushed = await notification.push("Actions", "Choose", [
      {
        label: "Sync",
        dismissOnClick: false,
        onClick: () => {
          throw new Error("sync failure");
        },
      },
      {
        label: "Async",
        dismissOnClick: false,
        onClick: async () => {
          throw new Error("async failure");
        },
      },
    ]);
    const payload = transport.shellCommand.mock.calls[0]?.[1] as {
      actions: Array<{ id: string }>;
    };
    for (const action of payload.actions) {
      transport.handlers.get("notification/action-clicked")?.({
        notificationId: pushed.id,
        actionId: action.id,
      });
    }
    await Promise.resolve();

    expect(errorSpy).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });

  it("returns the notification produced by Eden", async () => {
    createTransport();
    const notification = await loadNotification();

    const result = await notification.push("Title", "Message");

    expect(result).toMatchObject<Partial<Notification>>({
      id: "notification-1",
      title: "Title",
      message: "Message",
    });
  });
});
