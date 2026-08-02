import "reflect-metadata";
import * as fs from "node:fs/promises";
import type { UserProfile } from "@edenapp/types";
import { PermissionRegistry } from "../ipc";
import { createTestEden, type TestEden } from "../testing/createTestEden";

const caller = (appId: string, profile: UserProfile) => ({
  appId,
  principal: { kind: "user" as const, profile },
});

describe("FilesystemManager integration", () => {
  let eden: TestEden;

  afterEach(async () => {
    await eden?.dispose();
  });

  it("enforces command permissions while using the real isolated root", async () => {
    eden = await createTestEden();
    const profile = await eden.runtime.users.create({
      username: "filesystem-user",
      name: "Filesystem User",
      password: "password",
    });
    const permissions = eden.runtime.resolve(PermissionRegistry);
    permissions.registerApp("authorized-app", ["fs/write", "fs/read"]);
    permissions.registerApp("unauthorized-app", ["fs/read"]);

    await eden.execute(
      "fs/write",
      { path: "/authorized.txt", content: "allowed" },
      caller("authorized-app", profile),
    );
    await expect(
      eden.execute(
        "fs/read",
        { path: "/authorized.txt" },
        caller("authorized-app", profile),
      ),
    ).resolves.toBe("allowed");
    await expect(
      eden.execute(
        "fs/resolve",
        { path: "/authorized.txt" },
        caller("authorized-app", profile),
      ),
    ).rejects.toThrow("Permission denied: fs/resolve");

    permissions.registerApp("authorized-app", [
      "fs/write",
      "fs/read",
      "fs/resolve",
    ]);
    await expect(
      eden.execute(
        "fs/resolve",
        { path: "/authorized.txt" },
        caller("authorized-app", profile),
      ),
    ).resolves.toEqual({
      realPath: `${eden.paths.userDirectory}/authorized.txt`,
    });
    await expect(
      eden.execute(
        "fs/write",
        { path: "/denied.txt", content: "blocked" },
        caller("unauthorized-app", profile),
      ),
    ).rejects.toThrow("Permission denied: fs/write");
    await expect(
      fs.access(`${eden.paths.userDirectory}/denied.txt`),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
