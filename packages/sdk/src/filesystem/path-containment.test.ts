import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as Effect from "effect/Effect";
import {
  assertExistingPathWithin,
  assertPathWithin,
  PathOutsideRoot,
} from "./path-containment";

describe("path containment", () => {
  let directory: string;
  let root: string;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "eden-containment-"));
    root = path.join(directory, "root");
    await fs.mkdir(root);
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("allows the root and its descendants but rejects parents and sibling roots", () => {
    for (const target of [
      root,
      path.join(root, "nested/file"),
      path.join(root, "..notes"),
    ])
      expect(() => assertPathWithin(root, target)).not.toThrow();
    for (const target of [directory, `${root}-sibling/file`])
      expect(() => assertPathWithin(root, target)).toThrow(PathOutsideRoot);
  });

  it("allows missing descendants through contained symlinks and a symlinked root", async () => {
    await fs.mkdir(path.join(root, "inside"));
    await fs.symlink(path.join(root, "inside"), path.join(root, "link"));
    const rootAlias = path.join(directory, "root-alias");
    await fs.symlink(root, rootAlias);

    await expect(
      Effect.runPromise(
        assertExistingPathWithin(
          rootAlias,
          path.join(rootAlias, "link/new/file"),
        ),
      ),
    ).resolves.toBeUndefined();
  });

  it("allows the root itself and existing files within it", async () => {
    const file = path.join(root, "notes.txt");
    await fs.writeFile(file, "notes");
    await expect(
      Effect.runPromise(assertExistingPathWithin(root, root)),
    ).resolves.toBeUndefined();
    await expect(
      Effect.runPromise(assertExistingPathWithin(root, file)),
    ).resolves.toBeUndefined();
  });

  it("rejects lexical traversal even when the outside destination does not exist", async () => {
    await expect(
      Effect.runPromise(
        assertExistingPathWithin(root, path.join(root, "../outside/new/file")),
      ),
    ).rejects.toMatchObject({ _tag: "PathOutsideRoot" });
  });

  it("rejects a missing descendant reached through a symlink outside the root", async () => {
    const outside = path.join(directory, "outside");
    await fs.mkdir(outside);
    await fs.symlink(outside, path.join(root, "escape"));

    await expect(
      Effect.runPromise(
        assertExistingPathWithin(root, path.join(root, "escape/new/file")),
      ),
    ).rejects.toMatchObject({ _tag: "PathOutsideRoot" });
  });

  it("reports a missing root as an I/O failure with the native cause", async () => {
    const missing = path.join(directory, "missing");
    await expect(
      Effect.runPromise(
        assertExistingPathWithin(missing, path.join(missing, "file")),
      ),
    ).rejects.toMatchObject({
      _tag: "PathContainmentIoError",
      operation: "realpath",
      path: missing,
      cause: expect.objectContaining({ code: "ENOENT" }),
    });
  });

  it("rejects a dangling symlink instead of treating it as a missing descendant", async () => {
    const link = path.join(root, "dangling");
    await fs.symlink(path.join(directory, "missing"), link);
    await expect(
      Effect.runPromise(
        assertExistingPathWithin(root, path.join(link, "file")),
      ),
    ).rejects.toMatchObject({
      _tag: "PathContainmentIoError",
      operation: "realpath",
      path: link,
      cause: expect.objectContaining({ code: "ENOENT" }),
    });
  });

  it("preserves lookup failures other than a missing descendant", async () => {
    const file = path.join(root, "notes.txt");
    await fs.writeFile(file, "notes");
    const target = path.join(file, "child");
    await expect(
      Effect.runPromise(assertExistingPathWithin(root, target)),
    ).rejects.toMatchObject({
      _tag: "PathContainmentIoError",
      operation: "lstat",
      path: target,
      cause: expect.objectContaining({ code: "ENOTDIR" }),
    });
  });
});
