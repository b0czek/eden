import { afterEach, expect, it, vi } from "vitest";
import * as eden from "./index.js";

afterEach(() => vi.unstubAllGlobals());

it("can be imported without a runtime and rejects calls clearly", async () => {
  vi.stubGlobal("window", undefined);
  vi.stubGlobal("worker", undefined);
  await expect(eden.system.info()).rejects.toThrow(
    "requires an Eden frontend or backend runtime",
  );
  await expect(eden.volume.subscribe("changed", () => {})).rejects.toThrow(
    "requires an Eden frontend or backend runtime",
  );
  expect(() => eden.volume.unsubscribe("changed", () => {})).toThrow(
    "requires an Eden frontend or backend runtime",
  );
});

it("iterates a bridged stream reader and cancels it when the loop exits early", async () => {
  const chunks = [1, 2, 3];
  const cancel = vi.fn(async () => {});
  const stream = eden.toCommandStream({
    handle: { command: "example/feed", id: "stream" },
    next: async () =>
      chunks.length
        ? { done: false, value: chunks.shift() }
        : { done: true, value: undefined },
    cancel,
  });
  const received: unknown[] = [];
  for await (const chunk of stream) {
    received.push(chunk);
    if (received.length === 2) break;
  }
  expect(received).toEqual([1, 2]);
  expect(cancel).toHaveBeenCalledOnce();
});

it.each(["window", "worker"])(
  "resolves a %s API installed after import and preserves errors",
  async (runtime) => {
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("worker", undefined);
    const error = new Error("Permission denied");
    vi.stubGlobal(runtime, {
      edenAPI: {
        shellCommand: () => Promise.reject(error),
        subscribe: () => Promise.reject(error),
        unsubscribe: () => {
          throw error;
        },
      },
    });
    await expect(eden.system.info()).rejects.toBe(error);
    await expect(eden.volume.subscribe("changed", () => {})).rejects.toBe(
      error,
    );
    expect(() => eden.volume.unsubscribe("changed", () => {})).toThrow(error);
  },
);
