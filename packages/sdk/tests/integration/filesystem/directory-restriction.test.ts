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
import { UserDirectory } from "../../../src/runtime/inputs";
import {
  buildService,
  createEffectRuntime,
  type EffectRuntime,
} from "../../support/effect-runtime";

describe("Filesystem shared addresses and folder restrictions", () => {
  let root: string;
  let currentUser: UserProfile | null;
  let filesystem: Filesystem;
  let effects: EffectRuntime;
  const removed = createEvent<{ viewId: number; webContentsId: number }>();
  const views = { resolveViewId: () => undefined, removed };
  async function createFilesystemFixture(executionContext: ExecutionContext) {
    const volumes = await effects.acquire(buildService(Volumes, VolumesLive));
    return effects.acquire(
      buildService(Filesystem, FilesystemLive).pipe(
        Effect.provideService(UserDirectory, root),
        Effect.provideService(ExecutionContext, executionContext),
        Effect.provideService(FilesystemViews, views),
        Effect.provideService(Volumes, volumes),
      ),
    );
  }
  const createUser = (): UserProfile => ({
    username: "operator",
    name: "Operator",
    role: "standard",
    grants: ["*"],
    createdAt: 1,
    updatedAt: 1,
  });

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "eden-fs-"));
    currentUser = createUser();
    effects = createEffectRuntime();

    filesystem = await createFilesystemFixture({
      getPrincipal: () =>
        currentUser ? { kind: "user", profile: currentUser } : undefined,
    } as ExecutionContext);
  });

  afterEach(async () => {
    await effects.dispose();
    await fs.rm(root, { recursive: true, force: true });
  });

  it("keeps userDirectory as the root for unrestricted users and vendors", async () => {
    await expect(
      effects.run(
        filesystem.resolvePath({ volume: "home", path: "/Documents" }),
      ),
    ).resolves.toBe(path.join(root, "Documents"));

    currentUser = {
      ...createUser(),
      role: "vendor",
      directoryRestriction: "ignored",
    };
    await expect(
      effects.run(
        filesystem.resolvePath({ volume: "home", path: "/Documents" }),
      ),
    ).resolves.toBe(path.join(root, "Documents"));
  });

  it("maps system daemons to userDirectory", async () => {
    const executionContext = {
      getPrincipal: () => ({ kind: "system" as const }),
    } as unknown as ExecutionContext;
    filesystem = await createFilesystemFixture(executionContext);

    await expect(
      effects.run(
        filesystem.resolvePath({ volume: "home", path: "/state.json" }),
      ),
    ).resolves.toBe(path.join(root, "state.json"));
  });

  it("denies access without an execution principal", async () => {
    currentUser = null;
    await expect(
      effects.run(filesystem.resolvePath({ volume: "home", path: "/" })),
    ).rejects.toThrow("Caller has no filesystem execution principal");
  });

  it("shares actual contents and inverse addresses across identical and overlapping restrictions", async () => {
    const location = { volume: "home", path: "/projects/design/notes.txt" };
    await fs.mkdir(path.join(root, "projects/design"), { recursive: true });
    currentUser = { ...createUser(), directoryRestriction: "projects" };
    await effects.run(filesystem.writeFile(location, "project notes"));
    for (const restriction of ["projects", "projects/design", undefined]) {
      currentUser = {
        ...createUser(),
        username: restriction
          ? restriction.replaceAll("/", "-")
          : "unrestricted",
        directoryRestriction: restriction,
      };
      await expect(effects.run(filesystem.resolvePath(location))).resolves.toBe(
        path.join(root, "projects/design/notes.txt"),
      );
      await expect(effects.run(filesystem.readFile(location))).resolves.toBe(
        "project notes",
      );
      await expect(
        effects.run(
          filesystem.toMaskedPath(
            path.join(root, "projects/design/notes.txt"),
            "home",
          ),
        ),
      ).resolves.toEqual(location);
    }
    currentUser = { ...createUser(), directoryRestriction: "projects/design" };
    expect(filesystem.accessScope("home")).toEqual({
      volume: "home",
      path: "/projects/design",
    });
    await expect(
      effects.run(
        filesystem.toMaskedPath(path.join(root, "other/notes.txt"), "home"),
      ),
    ).rejects.toThrow("outside of the allowed directory");
  });

  it("rejects sibling reads, listings, writes, and transfers without changing files", async () => {
    await fs.mkdir(path.join(root, "projects/design"), { recursive: true });
    await fs.mkdir(path.join(root, "projects/research"), { recursive: true });
    const own = { volume: "home", path: "/projects/design/notes.txt" };
    const sibling = { volume: "home", path: "/projects/research/notes.txt" };
    await fs.writeFile(
      path.join(root, "projects/research/notes.txt"),
      "research notes",
    );
    currentUser = { ...createUser(), directoryRestriction: "projects/design" };
    await effects.run(filesystem.writeFile(own, "design notes"));
    for (const operation of [
      () => effects.run(filesystem.readFile(sibling)),
      () => effects.run(filesystem.stat(sibling)),
      () =>
        effects.run(filesystem.readdir({ volume: "home", path: "/projects" })),
      () => effects.run(filesystem.writeFile(sibling, "overwritten")),
      () => effects.run(filesystem.copy(sibling, own, true)),
      () => effects.run(filesystem.copy(own, sibling, true)),
      () => effects.run(filesystem.move(own, sibling, true)),
    ])
      await expect(operation()).rejects.toThrow(
        "outside of the allowed directory",
      );
    await expect(
      fs.readFile(path.join(root, "projects/research/notes.txt"), "utf8"),
    ).resolves.toBe("research notes");
    await expect(effects.run(filesystem.readFile(own))).resolves.toBe(
      "design notes",
    );
  });

  it("protects the assigned restriction folder from deletion, moves, and replacement", async () => {
    await fs.mkdir(path.join(root, "projects/design"), { recursive: true });
    const boundary = { volume: "home", path: "/projects/design" };
    const file = { volume: "home", path: "/projects/design/notes.txt" };
    currentUser = { ...createUser(), directoryRestriction: "projects/design" };
    await effects.run(filesystem.writeFile(file, "project notes"));
    await expect(effects.run(filesystem.delete(boundary))).rejects.toThrow(
      "access root",
    );
    await expect(
      effects.run(
        filesystem.move(boundary, {
          volume: "home",
          path: "/projects/design/moved",
        }),
      ),
    ).rejects.toThrow("access root");
    await expect(
      effects.run(filesystem.copy(file, boundary, true)),
    ).rejects.toThrow("access root");
    await expect(effects.run(filesystem.readFile(file))).resolves.toBe(
      "project notes",
    );
  });
});
