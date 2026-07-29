import "reflect-metadata";

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { UserProfile } from "@edenapp/types";
import type { CommandRegistry } from "../ipc";
import type { UserManager } from "../user";
import { FilesystemManager } from "./FilesystemManager";

describe("FilesystemManager user roots", () => {
  let root: string;
  let currentUser: UserProfile | null;
  let manager: FilesystemManager;
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

    manager = new FilesystemManager(
      root,
      { registerManager: jest.fn() } as unknown as CommandRegistry,
      {
        getCurrentUser: () => currentUser,
      } as unknown as UserManager,
    );
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("keeps userDirectory as the root for unrestricted users and vendors", async () => {
    await expect(manager.resolvePath("/Documents")).resolves.toBe(
      path.join(root, "Documents"),
    );

    currentUser = {
      ...createUser(),
      role: "vendor",
      homeDirectory: "ignored",
    };
    await expect(manager.resolvePath("/Documents")).resolves.toBe(
      path.join(root, "Documents"),
    );
  });

  it("maps virtual root to a configured relative home", async () => {
    await fs.mkdir(path.join(root, "teams", "operators"), {
      recursive: true,
    });
    currentUser = {
      ...createUser(),
      homeDirectory: "teams/operators",
    };

    await expect(manager.resolvePath("/Documents/report.txt")).resolves.toBe(
      path.join(root, "teams", "operators", "Documents", "report.txt"),
    );
  });

  it("denies access without an active session", async () => {
    currentUser = null;
    await expect(manager.resolvePath("/")).rejects.toThrow(
      "No active user session",
    );
  });

  it("rejects traversal outside the effective home", async () => {
    await fs.mkdir(path.join(root, "homes", "operator"), { recursive: true });
    currentUser = {
      ...createUser(),
      homeDirectory: "homes/operator",
    };

    await expect(manager.resolvePath("../../shared.txt")).rejects.toThrow(
      "outside of the allowed directory",
    );
  });

  it("rejects symlinks that escape the effective home", async () => {
    const home = path.join(root, "homes", "operator");
    const sibling = path.join(root, "homes", "other");
    await fs.mkdir(home, { recursive: true });
    await fs.mkdir(sibling, { recursive: true });
    await fs.symlink(sibling, path.join(home, "other"));
    currentUser = {
      ...createUser(),
      homeDirectory: "homes/operator",
    };

    await expect(manager.resolvePath("/other/private.txt")).rejects.toThrow(
      "outside of the allowed directory",
    );
    await expect(
      manager.writeFile("/other/private.txt", "secret"),
    ).rejects.toThrow("outside of the allowed directory");
  });
});
