import type { FileItem } from "@edenapp/files-core";
import { describe, expect, it } from "vitest";
import {
  createCopyName,
  findKeepBothPath,
  planTransfer,
  rememberCollisionAction,
} from "./fileTransfers";

const item = (overrides: Partial<FileItem> = {}): FileItem => ({
  name: "report.txt",
  path: "/Documents/report.txt",
  isDirectory: false,
  isFile: true,
  size: 10,
  modified: new Date(0),
  ...overrides,
});

describe("file transfer planning", () => {
  it("preserves file extensions in localized keep-both names", () => {
    expect(createCopyName(item(), "copy", 1)).toBe("report-copy.txt");
    expect(createCopyName(item(), "copy", 3)).toBe("report-copy-3.txt");
    expect(
      createCopyName(item({ name: ".env", path: "/.env" }), "copy", 1),
    ).toBe(".env-copy");
    expect(
      createCopyName(
        item({ name: "archive.tar.gz", path: "/archive.tar.gz" }),
        "kopia",
        2,
      ),
    ).toBe("archive.tar-kopia-2.gz");
  });

  it("finds the first available keep-both path", async () => {
    const existing = new Set([
      "/Documents/report-copy.txt",
      "/Documents/report-copy-2.txt",
    ]);
    await expect(
      findKeepBothPath(item(), "/Documents", "copy", async (path) =>
        existing.has(path),
      ),
    ).resolves.toBe("/Documents/report-copy-3.txt");
  });

  it("rejects directory destinations inside the source", () => {
    const folder = item({
      name: "Photos",
      path: "/Photos",
      isDirectory: true,
      isFile: false,
    });
    expect(planTransfer(folder, "/Photos", "copy")).toEqual({
      kind: "invalid",
      reason: "self-or-descendant",
    });
    expect(planTransfer(folder, "/Photos/Trips/2026", "move")).toEqual({
      kind: "invalid",
      reason: "self-or-descendant",
    });
  });

  it("keeps same-folder copies and treats same-folder moves as no-ops", () => {
    expect(planTransfer(item(), "/Documents", "copy")).toEqual({
      kind: "keep-both",
    });
    expect(planTransfer(item(), "/Documents", "move")).toEqual({
      kind: "no-op",
    });
  });

  it("remembers only apply-to-all collision actions", () => {
    expect(
      rememberCollisionAction(undefined, {
        action: "replace",
        applyToAll: false,
      }),
    ).toBeUndefined();
    expect(
      rememberCollisionAction(undefined, {
        action: "keep-both",
        applyToAll: true,
      }),
    ).toBe("keep-both");
    expect(
      rememberCollisionAction("skip", {
        action: "cancel",
        applyToAll: true,
      }),
    ).toBe("skip");
  });
});
