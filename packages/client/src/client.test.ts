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
