import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  createEffectRuntime,
  type EffectRuntime,
} from "../../../src/effects/runtime";
import {
  createUserManager,
  type UserManager,
} from "../../../src/user/UserManager";
import { createUserStore } from "../../../src/user/UserStore";

describe("UserManager accounts", () => {
  let appsDirectory: string;
  let userDirectory: string;
  let manager: UserManager;
  let effects: EffectRuntime;

  beforeEach(async () => {
    appsDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "eden-users-db-"));
    userDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), "eden-users-home-"),
    );
    effects = createEffectRuntime();
    const store = await effects.acquire(createUserStore({ appsDirectory }));
    manager = await effects.acquire(
      createUserManager({ store, userDirectory, restrictedApps: new Set() }),
    );
    await effects.run(manager.initialize());
  });

  afterEach(async () => {
    await effects.dispose();
    await fs.rm(appsDirectory, { recursive: true, force: true });
    await fs.rm(userDirectory, { recursive: true, force: true });
  });

  it("creates assigned restriction folders and preserves them when deleting a user", async () => {
    await effects.run(
      manager.createUser({
        username: "operator",
        name: "Operator",
        password: "password",
        directoryRestriction: "teams/operators",
      }),
    );
    const marker = path.join(userDirectory, "teams", "operators", "keep.txt");
    await fs.writeFile(marker, "keep");

    await effects.run(manager.deleteUser("operator"));

    await expect(fs.readFile(marker, "utf-8")).resolves.toBe("keep");
  });

  it("authenticates stored credentials without establishing a session", async () => {
    await effects.run(
      manager.createUser({
        username: "alice",
        name: "Alice",
        password: "password",
      }),
    );
    await expect(
      effects.run(manager.authenticate("alice", "password")),
    ).resolves.toMatchObject({ username: "alice" });
    await expect(
      effects.run(manager.authenticate("alice", "wrong")),
    ).rejects.toThrow("Invalid credentials");
  });

  it("resolves the configured default account", async () => {
    await effects.run(
      manager.createUser({
        username: "alice",
        name: "Alice",
        password: "password",
      }),
    );
    await effects.run(manager.setDefaultUsername("alice"));

    await expect(effects.run(manager.getDefaultUser())).resolves.toMatchObject({
      username: "alice",
    });
  });
});
