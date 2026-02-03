import fs from "fs";
import os from "os";
import path from "path";

import { CachedFileReader } from "./cachedFileReader";

describe("CachedFileReader", () => {
  const tempDirs: string[] = [];

  function createTempFile(initialContents: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eden-sdk-"));
    tempDirs.push(dir);
    const filePath = path.join(dir, "file.txt");
    fs.writeFileSync(filePath, initialContents, "utf-8");
    return filePath;
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("caches sync reads until the cache is flushed", () => {
    const reader = new CachedFileReader();
    const filePath = createTempFile("first");

    expect(reader.read(filePath)).toBe("first");
    expect(reader.isCached(filePath)).toBe(true);
    expect(reader.getCacheSize()).toBe(1);

    fs.writeFileSync(filePath, "second", "utf-8");
    expect(reader.read(filePath)).toBe("first");

    reader.flushFile(filePath);
    expect(reader.isCached(filePath)).toBe(false);
    expect(reader.read(filePath)).toBe("second");
  });

  it("caches async reads and supports flushing the entire cache", async () => {
    const reader = new CachedFileReader();
    const filePath = createTempFile("alpha");

    await expect(reader.readAsync(filePath)).resolves.toBe("alpha");
    expect(reader.isCached(filePath)).toBe(true);

    reader.flushCache();
    expect(reader.getCacheSize()).toBe(0);
    expect(reader.isCached(filePath)).toBe(false);

    fs.writeFileSync(filePath, "beta", "utf-8");
    await expect(reader.readAsync(filePath)).resolves.toBe("beta");
  });
});
