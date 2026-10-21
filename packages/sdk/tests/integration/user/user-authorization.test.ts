import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { UserProfile } from "@edenapp/types";
import type { Users } from "../../../src/user/service";
import { testApp } from "../../support/apps";
import { createTestEden, type TestEden } from "../../support/create-test-eden";

const mutations = [
  ["user/create", { username: "new", name: "New", password: "new-password" }],
  ["user/update", { username: "target", name: "Changed", grants: [] }],
  ["user/delete", { username: "target" }],
  ["user/set-password", { username: "target", password: "changed-password" }],
  ["user/set-default", { username: "target" }],
] as const;

describe("account command authorization", () => {
  let eden: TestEden;
  let users: Users;
  let vendor: UserProfile;
  let standard: UserProfile;

  beforeEach(async () => {
    eden = await createTestEden({ autoStart: false });
    const seedPath = path.join(eden.paths.distPath, "eden-seed.json");
    await fs.writeFile(
      seedPath,
      JSON.stringify({
        users: [
          {
            username: "vendor",
            name: "Vendor",
            role: "vendor",
            passwordHash: "unused",
            passwordSalt: "unused",
          },
        ],
        defaultUsername: "vendor",
      }),
    );
    await eden.start();
    users = eden.runtime.services.users;
    const seededVendor = await eden.runtime.effects.run(
      users.getUser("vendor"),
    );
    if (!seededVendor) throw new Error("Seeded vendor missing");
    vendor = seededVendor;
    standard = await eden.runtime.effects.run(
      users.createUser({
        username: "target",
        name: "Target",
        password: "password",
        grants: [],
      }),
    );
    eden.runtime.services.permissions.registerApp("account-users", [
      "user/manage",
    ]);
  });

  afterEach(async () => {
    await eden?.dispose();
  });

  describe.each([
    [
      "vendor without app permission",
      "unprivileged-app",
      "vendor",
      "Permission denied",
    ],
    [
      "permitted app without vendor account",
      "account-users",
      "standard",
      "Vendor account required",
    ],
  ] as const)("%s", (_label, appId, role, error) => {
    it.each(mutations)(
      "rejects %s without changing stored accounts",
      async (command, args) => {
        const before = await eden.runtime.effects.run(users.listUsers());
        await expect(
          eden.execute(command, args, {
            appId,
            principal: {
              kind: "user",
              profile: role === "vendor" ? vendor : standard,
            },
          }),
        ).rejects.toThrow(error);
        expect(await eden.runtime.effects.run(users.listUsers())).toEqual(
          before,
        );
        expect(users.getDefaultUsername()).toBe("vendor");
        await expect(
          eden.runtime.effects.run(users.authenticate("target", "password")),
        ).resolves.toEqual(standard);
      },
    );
  });

  it("allows a permitted vendor to create, update, reset credentials, set the default, and delete accounts", async () => {
    const caller = {
      appId: "account-users",
      principal: { kind: "user" as const, profile: vendor },
    };
    await eden.execute(
      "user/create",
      { username: "new", name: "New", password: "initial" },
      caller,
    );
    await eden.execute(
      "user/update",
      { username: "new", name: "Changed", grants: [] },
      caller,
    );
    await eden.execute(
      "user/set-password",
      { username: "new", password: "changed" },
      caller,
    );
    await expect(
      eden.runtime.effects.run(users.authenticate("new", "changed")),
    ).resolves.toMatchObject({
      name: "Changed",
      grants: [],
    });
    await expect(
      eden.runtime.effects.run(users.authenticate("new", "initial")),
    ).rejects.toThrow("Invalid credentials");
    await eden.execute("user/set-default", { username: "new" }, caller);
    expect(users.getDefaultUsername()).toBe("new");
    await eden.execute("user/delete", { username: "new" }, caller);
    expect(await eden.runtime.effects.run(users.getUser("new"))).toBeNull();
  });

  it("revokes a grant for an already running app on its next renderer command", async () => {
    const appId = "com.example.granted-reader";
    const grant = `app/${appId}/read`;
    eden.runtime.services.installedPackages.register(
      testApp(appId, {
        resolvedGrants: [
          {
            id: "read",
            label: "Read files",
            scope: "app",
            permissions: ["fs/read"],
          },
        ],
      }),
    );
    eden.runtime.services.permissions.registerApp(
      appId,
      [],
      [
        {
          id: "read",
          label: "Read files",
          scope: "app",
          permissions: ["fs/read"],
        },
      ],
    );
    await eden.runtime.effects.run(
      users.updateUser({
        username: standard.username,
        grants: [grant, `apps/launch/${appId}`],
      }),
    );
    await eden.runtime.effects.run(
      eden.runtime.sessions.login(standard.username, "password"),
    );
    await eden.complete("process/launch", { appId });
    const processes = eden.runtime.services.processes;
    const instance = processes.getAppInstance(appId);
    if (!instance) throw new Error("Reader app did not launch");
    const viewInfo = eden.runtime.services.views.getViewInfo(instance.viewId);
    if (!viewInfo) throw new Error("Reader view missing");
    const contents = viewInfo.view.webContents;
    const location = { volume: "home", path: "/grant.txt" };
    await fs.writeFile(
      path.join(eden.paths.userDirectory, "grant.txt"),
      "protected",
    );
    const read = () =>
      eden.platform.rendererIpc.invoke(
        "shell-command",
        contents.id,
        "fs/read",
        { location },
      );
    await expect(read()).resolves.toMatchObject({ result: "protected" });
    await eden.execute(
      "user/update",
      { username: standard.username, grants: [`apps/launch/${appId}`] },
      {
        appId: "account-users",
        principal: { kind: "user", profile: vendor },
      },
    );
    expect(processes.getAppInstance(appId)).toBe(instance);
    expect(contents.isDestroyed()).toBe(false);
    await expect(read()).rejects.toThrow("Grant denied");
  });
});
