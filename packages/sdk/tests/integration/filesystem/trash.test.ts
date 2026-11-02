import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { UserProfile } from "@edenapp/types";
import * as Effect from "effect/Effect";
import { createEvent } from "../../../src/core/events/event";
import { ExecutionContext } from "../../../src/core/execution/context";
import { FilesystemViews } from "../../../src/platform/filesystem/ports";
import {
  Filesystem,
  FilesystemLive,
} from "../../../src/platform/filesystem/service";
import {
  Volumes,
  VolumesLive,
} from "../../../src/platform/filesystem/volumes/service";
import { resolveDataLayout } from "../../../src/runtime/data-layout";
import { HomeDirectory, TrashDirectory } from "../../../src/runtime/inputs";
import {
  buildService,
  createEffectRuntime,
  type EffectRuntime,
} from "../../support/effect-runtime";

const home = (path: string) => ({ volume: "home", path });

describe("Filesystem Trash", () => {
  let dataRoot: string;
  let root: string;
  let trashRoot: string;
  let currentUser: UserProfile;
  let filesystem: Filesystem;
  let effects: EffectRuntime;
  const user = (
    username: string,
    directoryRestriction?: string,
    role: UserProfile["role"] = "standard",
  ): UserProfile => ({
    username,
    name: username,
    role,
    grants: ["*"],
    directoryRestriction,
    createdAt: 1,
    updatedAt: 1,
  });

  beforeEach(async () => {
    dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "eden-trash-"));
    const layout = resolveDataLayout(dataRoot);
    root = layout.homeDirectory;
    trashRoot = layout.trashDirectory;
    await fs.mkdir(root);
    await fs.mkdir(trashRoot);
    currentUser = user("operator");
    effects = createEffectRuntime();
    const volumes = await effects.acquire(buildService(Volumes, VolumesLive));
    filesystem = await effects.acquire(
      buildService(Filesystem, FilesystemLive).pipe(
        Effect.provideService(HomeDirectory, root),
        Effect.provideService(TrashDirectory, trashRoot),
        Effect.provideService(ExecutionContext, {
          getPrincipal: () => ({ kind: "user", profile: currentUser }),
        } as ExecutionContext),
        Effect.provideService(FilesystemViews, {
          resolveViewId: () => undefined,
          removed: createEvent<{ viewId: number; webContentsId: number }>(),
        }),
        Effect.provideService(Volumes, volumes),
      ),
    );
  });

  afterEach(async () => {
    await effects.dispose();
    await fs.rm(dataRoot, { recursive: true, force: true });
  });

  const entries = () => effects.run(filesystem.trashEntries());

  it("restores an item to its original folder, recreating missing parents", async () => {
    await fs.mkdir(path.join(root, "Documents", "Reports"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(root, "Documents", "Reports", "q1.txt"),
      "first quarter",
    );
    await effects.run(
      filesystem.moveToTrash(home("/Documents/Reports/q1.txt")),
    );

    const [entry] = await entries();
    expect(entry).toMatchObject({
      name: "q1.txt",
      original: home("/Documents/Reports/q1.txt"),
      isFile: true,
      size: "first quarter".length,
    });
    expect(Number.isNaN(Date.parse(entry.deletedAt))).toBe(false);
    await fs.rm(path.join(root, "Documents"), { recursive: true });

    await expect(
      effects.run(filesystem.restoreFromTrash(entry.id)),
    ).resolves.toEqual({
      status: "restored",
      location: home("/Documents/Reports/q1.txt"),
    });
    expect(
      await fs.readFile(
        path.join(root, "Documents", "Reports", "q1.txt"),
        "utf8",
      ),
    ).toBe("first quarter");
    expect(await entries()).toEqual([]);
  });

  it("keeps an occupying item and restores elsewhere on request", async () => {
    await fs.writeFile(path.join(root, "notes.txt"), "deleted notes");
    await effects.run(filesystem.moveToTrash(home("/notes.txt")));
    await fs.writeFile(path.join(root, "notes.txt"), "new notes");
    const [entry] = await entries();

    await expect(
      effects.run(filesystem.restoreFromTrash(entry.id)),
    ).resolves.toEqual({ status: "occupied" });
    expect(await fs.readFile(path.join(root, "notes.txt"), "utf8")).toBe(
      "new notes",
    );
    expect(await entries()).toHaveLength(1);

    await effects.run(
      filesystem.restoreFromTrash(entry.id, home("/notes (restored).txt")),
    );
    expect(
      await fs.readFile(path.join(root, "notes (restored).txt"), "utf8"),
    ).toBe("deleted notes");
  });

  it("moves a dangling link itself and restores its original target text", async () => {
    await fs.symlink("missing-target", path.join(root, "link"));
    await effects.run(filesystem.moveToTrash(home("/link")));
    const [entry] = await entries();
    expect(entry).toMatchObject({ isFile: false, isDirectory: false });
    await effects.run(filesystem.restoreFromTrash(entry.id));
    expect(await fs.readlink(path.join(root, "link"))).toBe("missing-target");
  });

  it("stores Trash outside Home", async () => {
    await fs.writeFile(path.join(root, "secret.txt"), "secret");
    await effects.run(filesystem.moveToTrash(home("/secret.txt")));

    expect(await fs.readdir(root)).toEqual([]);
    expect(await effects.run(filesystem.readdir(home("/")))).toEqual([]);
    const [entry] = await entries();
    expect(
      await fs.readFile(path.join(trashRoot, entry.id, "content"), "utf8"),
    ).toBe("secret");
  });

  it("shows each user only items deleted from folders they can access", async () => {
    await fs.mkdir(path.join(root, "alice"));
    await fs.mkdir(path.join(root, "bob"));
    await fs.writeFile(path.join(root, "alice", "plan.txt"), "alice");
    currentUser = user("alice", "alice");
    await effects.run(filesystem.moveToTrash(home("/alice/plan.txt")));
    const [entry] = await entries();

    currentUser = user("bob", "bob");
    expect(await entries()).toEqual([]);
    await expect(
      effects.run(filesystem.restoreFromTrash(entry.id)),
    ).rejects.toMatchObject({ message: "Trash item is unavailable" });
    await expect(
      effects.run(filesystem.deleteFromTrash(entry.id)),
    ).rejects.toMatchObject({ message: "Trash item is unavailable" });
    await effects.run(filesystem.emptyTrash());

    currentUser = user("vendor", undefined, "vendor");
    expect(await entries()).toEqual([entry]);
  });

  it("deletes entries permanently and announces each change", async () => {
    const revisions: number[] = [];
    const stop = filesystem.trashChanged.on(({ revision }) => {
      revisions.push(revision);
    });
    try {
      for (const name of ["a.txt", "b.txt", "c.txt"]) {
        await fs.writeFile(path.join(root, name), name);
        await effects.run(filesystem.moveToTrash(home(`/${name}`)));
      }
      const [newest] = await entries();
      await effects.run(filesystem.deleteFromTrash(newest.id));
      expect(await entries()).toHaveLength(2);
      await effects.run(filesystem.emptyTrash());
      expect(await entries()).toEqual([]);
      expect(await fs.readdir(trashRoot)).toEqual([]);
      expect(revisions).toEqual([1, 2, 3, 4, 5]);
    } finally {
      stop();
    }
  });

  it("refuses items outside Home and leaves no storage behind on failure", async () => {
    await expect(
      effects.run(filesystem.moveToTrash({ volume: "usb", path: "/a.txt" })),
    ).rejects.toMatchObject({
      message: "Trash only holds items from Home",
    });
    await expect(
      effects.run(filesystem.moveToTrash(home("/missing.txt"))),
    ).rejects.toThrow();
    expect(await entries()).toEqual([]);
    expect(await fs.readdir(trashRoot)).toEqual([]);
  });
});
