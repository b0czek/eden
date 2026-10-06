import type { FilePickerResult } from "@edenapp/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createTransport = () => {
  let closed: ((result: FilePickerResult) => void) | undefined;
  let opened: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    opened = resolve;
  });
  vi.stubGlobal("window", {
    edenAPI: {
      subscribe: async (_event: string, handler: typeof closed) => {
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
