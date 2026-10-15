import type { FilePickerResult } from "@edenapp/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createTransport = (subscriptionFailures = 0) => {
  let closed: ((result: FilePickerResult) => void) | undefined;
  let opened: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    opened = resolve;
  });
  vi.stubGlobal("window", {
    edenAPI: {
      subscribe: async (_event: string, handler: typeof closed) => {
        if (subscriptionFailures-- > 0) {
          throw new Error("Subscription failed");
        }
        closed = handler;
      },
      shellCommand: async () => {
        opened?.();
        return { requestId: "picker-1" };
      },
    },
  });
  return {
    resolve: async (result: Omit<FilePickerResult, "requestId">) => {
      await ready;
      // Let pick register its resolver after receiving the open response.
      await Promise.resolve();
      closed?.({ requestId: "picker-1", ...result });
    },
  };
};

describe("filePicker selection helpers", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it.each(["select", "cancel"] as const)(
    "retries a rejected subscription and resolves a subsequent %s",
    async (reason) => {
      const transport = createTransport(1);
      const { filePicker } = await import("./file-picker");
      await expect(filePicker.openFile()).rejects.toThrow(
        "Subscription failed",
      );
      const selected = filePicker.openFile();
      const location = { volume: "home", path: "/retry.txt" };
      await transport.resolve({
        reason,
        locations: reason === "select" ? [location] : undefined,
      });
      await expect(selected).resolves.toEqual(
        reason === "select" ? location : null,
      );
    },
  );

  it.each(["openFile", "openDirectory", "saveFile"] as const)(
    "%s returns the first location from a selection",
    async (method) => {
      const transport = createTransport();
      const { filePicker } = await import("./file-picker");
      const locations = [
        { volume: "usb", path: "/one.txt" },
        { volume: "home", path: "/two.txt" },
      ];
      const selected = filePicker[method]();
      await transport.resolve({ reason: "select", locations });
      await expect(selected).resolves.toEqual(locations[0]);
    },
  );

  it("openFiles returns all selected locations", async () => {
    const transport = createTransport();
    const { filePicker } = await import("./file-picker");
    const locations = [
      { volume: "usb", path: "/one.txt" },
      { volume: "home", path: "/two.txt" },
    ];
    const selected = filePicker.openFiles();
    await transport.resolve({ reason: "select", locations });
    await expect(selected).resolves.toEqual(locations);
  });

  it.each(["openFile", "openFiles", "openDirectory", "saveFile"] as const)(
    "%s returns null on cancellation",
    async (method) => {
      const transport = createTransport();
      const { filePicker } = await import("./file-picker");
      const selected = filePicker[method]();
      await transport.resolve({ reason: "cancel" });
      await expect(selected).resolves.toBeNull();
    },
  );
});
