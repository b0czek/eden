import "reflect-metadata";

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { EdenConfig } from "@edenapp/types";
import type { CommandRegistry, IPCBridge } from "../ipc";
import { UserManager } from "./UserManager";

describe("UserManager home and session lifecycle", () => {
  let appsDirectory: string;
  let userDirectory: string;
  let manager: UserManager;

  beforeEach(async () => {
    appsDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "eden-users-db-"));
    userDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), "eden-users-home-"),
    );
    manager = new UserManager(
      {
        eventSubscribers: { notify: jest.fn() },
      } as unknown as IPCBridge,
      { registerManager: jest.fn() } as unknown as CommandRegistry,
      {} as EdenConfig,
      appsDirectory,
      userDirectory,
    );
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

  it("runs session shutdown hooks before publishing the next user", async () => {
    await manager.createUser({
      username: "alice",
      name: "Alice",
      password: "password",
    });
    await manager.createUser({
      username: "bob",
      name: "Bob",
      password: "password",
    });
    await manager.login("alice", "password");

    const observedUsers: Array<string | null> = [];
    manager.onBeforeSessionChange(async () => {
      observedUsers.push(manager.getCurrentUser()?.username ?? null);
    });

    await manager.login("bob", "password");

    expect(observedUsers).toEqual(["alice"]);
    expect(manager.getCurrentUser()?.username).toBe("bob");
  });

  it("keeps the current session when a shutdown hook fails", async () => {
    await manager.createUser({
      username: "alice",
      name: "Alice",
      password: "password",
    });
    await manager.createUser({
      username: "bob",
      name: "Bob",
      password: "password",
    });
    await manager.login("alice", "password");
    manager.onBeforeSessionChange(async () => {
      throw new Error("shutdown failed");
    });

    await expect(manager.login("bob", "password")).rejects.toThrow(
      "shutdown failed",
    );
    expect(manager.getCurrentUser()?.username).toBe("alice");
  });
});
