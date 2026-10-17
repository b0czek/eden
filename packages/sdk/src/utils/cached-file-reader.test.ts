import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Effect from "effect/Effect";
import { createEffectRuntime } from "../../tests/support/effect-runtime";
import { createCachedFileReader } from "./cached-file-reader";

describe("cached asset reads", () => {
  let directory: string;
  let effects: ReturnType<typeof createEffectRuntime>;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "eden-sdk-"));
    effects = createEffectRuntime();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await effects.dispose();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("keeps successful reads for the rendering lifetime", async () => {
    const reader = await effects.acquire(createCachedFileReader());
    const filePath = path.join(directory, "asset.css");
    fs.writeFileSync(filePath, "first");
    expect(await effects.run(reader.read(filePath))).toBe("first");
    fs.writeFileSync(filePath, "second");
    expect(await effects.run(reader.read(filePath))).toBe("first");
  });

  it("shares one pending native read across concurrent requests", async () => {
    const reader = await effects.acquire(createCachedFileReader());
    let started!: () => void;
    const reading = new Promise<void>((resolve) => {
      started = resolve;
    });
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const read = jest
      .spyOn(fs.promises, "readFile")
      .mockImplementation(async () => {
        started();
        await pending;
        return "shared asset";
      });
    const result = effects.run(
      Effect.all([reader.read("asset.css"), reader.read("asset.css")], {
        concurrency: "unbounded",
      }),
    );
    await reading;
    finish();
    expect(await result).toEqual(["shared asset", "shared asset"]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("retries immediately after a failed read", async () => {
    const reader = await effects.acquire(createCachedFileReader());
    const filePath = path.join(directory, "late.css");
    await expect(effects.run(reader.read(filePath))).rejects.toThrow("ENOENT");
    fs.writeFileSync(filePath, "now present");
    expect(await effects.run(reader.read(filePath))).toBe("now present");
  });
});
