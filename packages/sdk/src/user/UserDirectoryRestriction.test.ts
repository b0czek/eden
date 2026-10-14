import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  ensureDirectoryRestriction,
  normalizeDirectoryRestriction,
} from "./UserDirectoryRestriction";

describe("user directory restrictions", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "eden-home-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("normalizes blank and portable relative paths", () => {
    expect(normalizeDirectoryRestriction("")).toBeUndefined();
    expect(normalizeDirectoryRestriction(".")).toBeUndefined();
    expect(normalizeDirectoryRestriction(" teams\\operators ")).toBe(
      "teams/operators",
    );
  });

  it("rejects absolute and escaping paths", () => {
    expect(() => normalizeDirectoryRestriction("/tmp/home")).toThrow(
      "must be relative",
    );
    expect(() => normalizeDirectoryRestriction("C:\\Users\\operator")).toThrow(
      "must be relative",
    );
    expect(() => normalizeDirectoryRestriction("../../outside")).toThrow(
      "cannot leave",
    );
  });

  it("creates a missing restricted folder", async () => {
    await expect(
      ensureDirectoryRestriction(root, "standard", "teams/operators"),
    ).resolves.toBe("teams/operators");
    await expect(
      fs.stat(path.join(root, "teams", "operators")),
    ).resolves.toEqual(expect.objectContaining({}));
  });

  it("rejects folder restrictions for vendors", async () => {
    await expect(
      ensureDirectoryRestriction(root, "vendor", "homes/vendor"),
    ).rejects.toThrow("always use the userDirectory root");
  });

  it("rejects a restriction reached through a symlink outside userDirectory", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "eden-outside-"));
    try {
      await fs.symlink(outside, path.join(root, "escape"));
      await expect(
        ensureDirectoryRestriction(root, "standard", "escape/home"),
      ).rejects.toThrow("outside of the allowed directory");
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});
