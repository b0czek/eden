import "reflect-metadata";

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { EdenConfig } from "@edenapp/types";
import { UserManager } from "./UserManager";

describe("UserManager accounts", () => {
  let appsDirectory: string;
  let userDirectory: string;
  let manager: UserManager;

  beforeEach(async () => {
    appsDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "eden-users-db-"));
    userDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), "eden-users-home-"),
    );
    manager = new UserManager({} as EdenConfig, appsDirectory, userDirectory);
  });

  afterEach(async () => {
    await fs.rm(appsDirectory, { recursive: true, force: true });
    await fs.rm(userDirectory, { recursive: true, force: true });
  });

  it("creates assigned homes and preserves them when deleting a user", async () => {
    await manager.createUser({
      username: "operator",
      name: "Operator",
      password: "password",
      homeDirectory: "teams/operators",
    });
    const marker = path.join(userDirectory, "teams", "operators", "keep.txt");
    await fs.writeFile(marker, "keep");

    await manager.deleteUser("operator");

    await expect(fs.readFile(marker, "utf-8")).resolves.toBe("keep");
  });

  it("authenticates stored credentials without establishing a session", async () => {
    await manager.createUser({
      username: "alice",
      name: "Alice",
      password: "password",
    });
    await expect(
      manager.authenticate("alice", "password"),
    ).resolves.toMatchObject({ username: "alice" });
    await expect(manager.authenticate("alice", "wrong")).rejects.toThrow(
      "Invalid credentials",
    );
  });

  it("resolves the configured default account", async () => {
    await manager.createUser({
      username: "alice",
      name: "Alice",
      password: "password",
    });
    await manager.setDefaultUsername("alice");

    await expect(manager.getDefaultUser()).resolves.toMatchObject({
      username: "alice",
    });
  });
});
