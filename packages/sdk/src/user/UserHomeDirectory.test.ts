import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  ensureHomeDirectory,
  normalizeHomeDirectory,
} from "./UserHomeDirectory";

describe("user home directories", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "eden-home-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("normalizes blank and portable relative paths", () => {
    expect(normalizeHomeDirectory("")).toBeUndefined();
    expect(normalizeHomeDirectory(".")).toBeUndefined();
    expect(normalizeHomeDirectory(" teams\\operators ")).toBe(
      "teams/operators",
    );
  });

  it("rejects absolute and escaping paths", () => {
    expect(() => normalizeHomeDirectory("/tmp/home")).toThrow(
      "must be relative",
    );
    expect(() => normalizeHomeDirectory("C:\\Users\\operator")).toThrow(
      "must be relative",
    );
    expect(() => normalizeHomeDirectory("../../outside")).toThrow(
      "cannot leave",
    );
  });

  it("creates a missing standard-user home", async () => {
    await expect(
      ensureHomeDirectory(root, "standard", "teams/operators"),
    ).resolves.toBe("teams/operators");
    await expect(
      fs.stat(path.join(root, "teams", "operators")),
    ).resolves.toEqual(expect.objectContaining({}));
  });

  it("rejects configured homes for vendors", async () => {
    await expect(
      ensureHomeDirectory(root, "vendor", "homes/vendor"),
    ).rejects.toThrow("always use the userDirectory root");
  });

  it("rejects a home reached through a symlink outside userDirectory", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "eden-outside-"));
    try {
      await fs.symlink(outside, path.join(root, "escape"));
      await expect(
        ensureHomeDirectory(root, "standard", "escape/home"),
      ).rejects.toThrow("outside of the allowed directory");
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});
