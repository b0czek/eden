import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  AppAssociation,
  RuntimeAppManifest,
  RuntimeDlcManifest,
  UserProfile,
  WallpaperConfig,
} from "@edenapp/types";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { testApp } from "../../support/apps";
import { createTestEden, type TestEden } from "../../support/createTestEden";

describe("control-plane API integration", () => {
  let eden: TestEden;

  afterEach(async () => {
    await eden?.dispose();
  });

  it("defers host mutations and input validation until their Effects execute", async () => {
    eden = await createTestEden();
    const pending = eden.runtime.users.create({
      username: "lazy",
      name: "Lazy",
      password: "password",
    });
    expect(await eden.runtime.effects.run(eden.runtime.users.list())).toEqual(
      [],
    );
    const user = await eden.runtime.effects.run(pending);
    expect(user.username).toBe("lazy");
    expect(
      (await eden.runtime.effects.run(eden.runtime.users.list())).map(
        (user) => user.username,
      ),
    ).toEqual(["lazy"]);
    const invalid = eden.runtime.users.create({
      username: "bad",
      name: "Bad",
      password: 42,
    } as never);
    await expect(eden.runtime.effects.run(invalid)).rejects.toThrow();
    expect(
      (await eden.runtime.effects.run(eden.runtime.users.list())).map(
        (user) => user.username,
      ),
    ).toEqual(["lazy"]);
  });

  it("keeps host eject awaited and drains it before disposing runtime resources", async () => {
    eden = await createTestEden();
    const drive = path.join(eden.paths.root, "host-eject");
    await fs.mkdir(drive);
    let begin!: () => void;
    let finish!: () => void;
    const started = new Promise<void>((resolve) => {
      begin = resolve;
    });
    const completed = new Promise<void>((resolve) => {
      finish = resolve;
    });
    await eden.runtime.effects.run(
      eden.runtime.volumes.register(
        {
          id: "host-eject",
          label: "Host eject",
          kind: "removable",
          rootPath: drive,
        },
        {
          eject: () =>
            Effect.promise(async () => {
              begin();
              await completed;
            }),
        },
      ),
    );
    const observed: string[] = [];
    const off = eden.runtime.operations.onChanged((snapshot) => {
      if (snapshot.command === "volume/eject") observed.push(snapshot.status);
    });
    const removal = eden.runtime.effects.run(
      eden.runtime.volumes.eject("host-eject"),
    );
    expect(observed).toEqual(["queued"]);
    await started;
    const snapshot = eden.runtime.operations
      .list()
      .find((snapshot) => snapshot.command === "volume/eject");
    assert(snapshot, "Eject operation is missing");
    expect(snapshot).toMatchObject({ status: "running", phase: "host-eject" });
    snapshot.phase = "changed by observer";
    expect(eden.runtime.operations.get(snapshot)?.phase).toBe("host-eject");
    let disposed = false;
    const shutdown = eden.runtime.dispose().then(() => {
      disposed = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(disposed).toBe(false);
    finish();
    await removal;
    await shutdown;
    expect(observed.at(-1)).toBe("succeeded");
    expect(eden.platform.activeResourceCount).toBe(0);
    off();
  });

  it("preserves domain failure tags for typed host recovery", async () => {
    eden = await createTestEden();
    const input = {
      username: "operator",
      name: "Operator",
      password: "password",
    };
    await eden.runtime.effects.run(eden.runtime.users.create(input));
    const recovered = await eden.runtime.effects.run(
      eden.runtime.users
        .create(input)
        .pipe(
          Effect.catchTag("UserAlreadyExistsError", (failure) =>
            Effect.succeed({ existing: failure.username }),
          ),
        ),
    );
    expect(recovered).toEqual({ existing: "operator" });
    expect(
      await eden.runtime.effects.run(eden.runtime.users.list()),
    ).toHaveLength(1);
  });

  it("keeps unexpected SDK workflow construction exceptions as defects", async () => {
    eden = await createTestEden();
    const defect = new Error("Broken volume registration implementation");
    const registration = jest
      .spyOn(eden.runtime.services.volumes, "register")
      .mockImplementation(() => {
        throw defect;
      });
    try {
      const exit = await eden.runtime.effects.run(
        Effect.exit(
          eden.runtime.volumes.register({
            id: "external",
            label: "External",
            kind: "removable",
            rootPath: eden.paths.root,
          }),
        ),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.hasDies(exit.cause)).toBe(true);
        expect(Cause.hasFails(exit.cause)).toBe(false);
        expect(Cause.squash(exit.cause)).toBe(defect);
      }
    } finally {
      registration.mockRestore();
    }
  });

  it("lists trusted package inventory without a user session", async () => {
    eden = await createTestEden();
    const app: RuntimeAppManifest = {
      kind: "app",
      id: "com.example.sessionless-app",
      name: "Sessionless App",
      version: "1.0.0",
      frontend: { entry: "index.html" },
      isPrebuilt: false,
      isDevelopment: false,
      isCore: false,
      isRestricted: true,
      resolvedGrants: [],
    };
    const dlc: RuntimeDlcManifest = {
      kind: "dlc",
      id: "com.example.sessionless-dlc",
      name: "Sessionless DLC",
      version: "1.0.0",
      hostAppId: app.id,
      contributions: [],
      isPrebuilt: false,
    };
    const registry = eden.runtime.services.installedPackages;
    registry.register(app);
    registry.register(dlc);

    expect(eden.runtime.sessions.current()).toBeNull();
    expect(eden.runtime.packages.list()).toEqual([app, dlc]);
    expect(eden.runtime.packages.list({ kind: "app" })).toEqual([app]);
    expect(eden.runtime.packages.list({ kind: "dlc" })).toEqual([dlc]);
  });

  it("returns detached data and synchronizes session changes", async () => {
    eden = await createTestEden();
    const app = testApp("com.example.control-plane", {
      name: "Control Plane App",
    });
    eden.runtime.services.installedPackages.register(app);

    const user = await eden.runtime.effects.run(
      eden.runtime.users.create({
        username: "operator",
        name: "Operator",
        password: "password",
        grants: [`apps/launch/${app.id}`],
      }),
    );
    await eden.runtime.effects.run(
      eden.runtime.sessions.login(user.username, "password"),
    );

    const listed = eden.runtime.packages.list();
    expect(listed).toHaveLength(1);
    listed[0].name = "Changed by host";
    expect(eden.runtime.packages.get(app.id)?.manifest.name).toBe(
      "Control Plane App",
    );

    const changes: Array<UserProfile | null> = [];
    const unsubscribe = eden.runtime.sessions.onChanged(({ currentUser }) => {
      changes.push(currentUser);
    });
    const updated = await eden.runtime.effects.run(
      eden.runtime.users.update({
        username: user.username,
        name: "Renamed",
      }),
    );
    expect(eden.runtime.sessions.current()).toMatchObject({ name: "Renamed" });
    expect(updated).not.toBe(eden.runtime.sessions.current());

    await eden.runtime.effects.run(eden.runtime.sessions.logout());
    unsubscribe();
    unsubscribe();
    await eden.runtime.effects.run(
      eden.runtime.sessions.login(user.username, "password"),
    );
    expect(changes).toEqual([
      expect.objectContaining({ username: user.username, name: "Renamed" }),
      null,
    ]);
  });

  it("rejects malformed SDK wallpaper input before persistence or notifications", async () => {
    eden = await createTestEden();
    const settings = eden.runtime.services.settings;
    const before = await eden.runtime.effects.run(
      settings.get("com.eden", "appearance.wallpaper"),
    );
    const wallpaper = await eden.runtime.effects.run(
      eden.runtime.appearance.getWallpaper(),
    );
    const changes: unknown[] = [];
    const stop = eden.runtime.appearance.onChanged((value) =>
      changes.push(value),
    );
    try {
      await expect(
        eden.runtime.effects.run(
          eden.runtime.appearance.setWallpaper({
            type: "custom",
            value: 42,
          } as unknown as WallpaperConfig),
        ),
      ).rejects.toMatchObject({ name: "ValiError" });
      expect(
        await eden.runtime.effects.run(
          settings.get("com.eden", "appearance.wallpaper"),
        ),
      ).toBe(before);
      expect(
        await eden.runtime.effects.run(eden.runtime.appearance.getWallpaper()),
      ).toEqual(wallpaper);
      expect(changes).toEqual([]);
    } finally {
      stop();
    }
  });

  it("applies the same association input contract at SDK and EdenAPI boundaries", async () => {
    eden = await createTestEden();
    const selected = { appId: "com.example.selected", kind: "provider" };
    await eden.runtime.effects.run(
      eden.runtime.associations.set("provider:test", selected),
    );
    const invalid = { appId: 42, kind: "provider" };
    await expect(
      eden.runtime.effects.run(
        eden.runtime.associations.set(
          "provider:test",
          invalid as unknown as AppAssociation,
        ),
      ),
    ).rejects.toMatchObject({ name: "ValiError" });
    await expect(
      eden.execute("associations/set", { key: "provider:test", ...invalid }),
    ).rejects.toMatchObject({ name: "ValiError" });
    expect(eden.runtime.associations.get("provider:test")).toEqual(selected);
    await expect(
      eden.runtime.effects.run(eden.runtime.associations.remove(" ")),
    ).rejects.toMatchObject({
      name: "ValiError",
    });
    expect(() => eden.runtime.associations.list(null as never)).toThrow();
  });

  it("delivers detached native Effect events under SDK authority without inheriting the app caller", async () => {
    eden = await createTestEden();
    const execution = eden.runtime.services.execution;
    eden.runtime.services.permissions.registerApp("app.sdk-origin", [
      "appearance/manage",
    ]);
    const contexts: unknown[] = [];
    const stop = eden.runtime.appearance.onChanged((wallpaper) => {
      contexts.push(structuredClone(execution.get()));
      wallpaper.value = "changed by observer";
    });
    try {
      await eden.execute(
        "appearance/set-wallpaper",
        { wallpaper: { type: "custom", value: "#123456" } },
        {
          appId: "app.sdk-origin",
          webContentsId: 42,
          operationId: "foreign-operation",
          principal: { kind: "system" },
        },
      );
      expect(contexts).toEqual([{ principal: { kind: "system" } }]);
      expect(
        await eden.runtime.effects.run(eden.runtime.appearance.getWallpaper()),
      ).toMatchObject({
        value: "#123456",
      });
      const input: WallpaperConfig = { type: "custom", value: "#abcdef" };
      const update = eden.runtime.effects.run(
        eden.runtime.appearance.setWallpaper(input),
      );
      input.value = "mutated after submission";
      await update;
      expect(
        await eden.runtime.effects.run(eden.runtime.appearance.getWallpaper()),
      ).toMatchObject({
        value: "#abcdef",
      });
    } finally {
      stop();
    }
  });
});
