import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as Effect from "effect/Effect";
import { AppsDirectory, UserDirectory } from "../../../src/runtime/inputs";
import {
  Users,
  UsersLive,
  UsersRestrictedApps,
} from "../../../src/user/service";
import { UserStorage, UserStorageLive } from "../../../src/user/storage";
import {
  buildService,
  createEffectRuntime,
  type EffectRuntime,
} from "../../support/effect-runtime";

describe("Users accounts", () => {
  let appsDirectory: string;
  let userDirectory: string;
  let users: Users;
  let effects: EffectRuntime;

  beforeEach(async () => {
    appsDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "eden-users-db-"));
    userDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), "eden-users-home-"),
    );
    effects = createEffectRuntime();
    const store = await effects.acquire(
      buildService(UserStorage, UserStorageLive).pipe(
        Effect.provideService(AppsDirectory, appsDirectory),
      ),
    );
    users = await effects.acquire(
      buildService(Users, UsersLive).pipe(
        Effect.provideService(UserStorage, store),
        Effect.provideService(UserDirectory, userDirectory),
        Effect.provideService(UsersRestrictedApps, new Set()),
      ),
    );
    await effects.run(users.initialize());
  });

  afterEach(async () => {
    await effects.dispose();
    await fs.rm(appsDirectory, { recursive: true, force: true });
    await fs.rm(userDirectory, { recursive: true, force: true });
  });

  it("creates assigned restriction folders and preserves them when deleting a user", async () => {
    await effects.run(
      users.createUser({
        username: "operator",
        name: "Operator",
        password: "password",
        directoryRestriction: "teams/operators",
      }),
    );
    const marker = path.join(userDirectory, "teams", "operators", "keep.txt");
    await fs.writeFile(marker, "keep");

    await effects.run(users.deleteUser("operator"));

    await expect(fs.readFile(marker, "utf-8")).resolves.toBe("keep");
  });

  it("authenticates stored credentials and rejects an incorrect password", async () => {
    await effects.run(
      users.createUser({
        username: "alice",
        name: "Alice",
        password: "password",
      }),
    );
    await expect(
      effects.run(users.authenticate("alice", "password")),
    ).resolves.toMatchObject({ username: "alice" });
    await expect(
      effects.run(users.authenticate("alice", "wrong")),
    ).rejects.toThrow("Invalid credentials");
  });

  it("resolves the configured default account", async () => {
    await effects.run(
      users.createUser({
        username: "alice",
        name: "Alice",
        password: "password",
      }),
    );
    await effects.run(users.setDefaultUsername("alice"));

    await expect(effects.run(users.getDefaultUser())).resolves.toMatchObject({
      username: "alice",
    });
  });
});
