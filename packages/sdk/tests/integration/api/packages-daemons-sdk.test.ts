import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { DaemonDefinition } from "@edenapp/types";
import * as v from "valibot";
import { testApp } from "../../support/apps";
import { createTestEden, type TestEden } from "../../support/createTestEden";

describe("package and daemon SDK boundaries", () => {
  let eden: TestEden;
  afterEach(async () => {
    await eden?.dispose();
  });

  it("rejects malformed package inputs before admission and leaves package existence checks to the service", async () => {
    eden = await createTestEden();
    const packages = eden.runtime.packages;
    expect(() => packages.list({ showHidden: "yes" } as never)).toThrow(
      v.ValiError,
    );
    expect(() => packages.list({ kind: "widget" } as never)).toThrow(
      v.ValiError,
    );
    expect(() => packages.get(7 as never)).toThrow(v.ValiError);
    expect(() => packages.onChanged(null as never)).toThrow(v.ValiError);
    await expect(
      eden.runtime.effects.run(packages.getSize(null as never)),
    ).rejects.toThrow(v.ValiError);
    await expect(
      eden.runtime.effects.run(packages.uninstall("" as never)),
    ).rejects.toThrow(v.ValiError);
    await expect(
      eden.runtime.effects.run(packages.inspect("relative.edenite")),
    ).rejects.toThrow(v.ValiError);
    await expect(
      eden.runtime.effects.run(packages.install("relative.edenite")),
    ).rejects.toThrow(v.ValiError);
    const missing = path.join(eden.paths.root, "missing.edenite");
    await expect(
      eden.runtime.effects.run(
        packages.install(missing, { replace: "false" } as never),
      ),
    ).rejects.toThrow(v.ValiError);
    expect(eden.runtime.operations.list()).toEqual([]);
    await expect(
      eden.runtime.effects.run(packages.inspect(missing)),
    ).resolves.toMatchObject({
      success: false,
    });
    await expect(
      eden.runtime.effects.run(packages.install(missing)),
    ).rejects.toThrow("File not found:");
    expect(eden.runtime.operations.list()).toEqual([
      expect.objectContaining({ command: "package/install", status: "failed" }),
    ]);
  });

  it("rejects malformed daemon identities and definitions without persisting or admitting work", async () => {
    eden = await createTestEden();
    const appId = "app.sdk-daemon";
    eden.runtime.services.installedPackages.register(
      testApp(appId, {
        frontend: undefined,
        backend: { entry: "backend.js" },
      }),
    );
    const definition: DaemonDefinition = {
      appId,
      enabled: false,
      runAs: null,
      restart: "never",
    };
    await eden.runtime.effects.run(
      eden.runtime.daemons.updateDefinition(definition),
    );
    const invalidDefinitions = [
      { ...definition, enabled: "false" },
      { ...definition, restart: "sometimes" },
      { ...definition, runAs: { kind: "system" } },
      { ...definition, runAs: { kind: "user", username: 3 } },
    ];
    for (const invalid of invalidDefinitions)
      await expect(
        eden.runtime.effects.run(
          eden.runtime.daemons.updateDefinition(invalid as never),
        ),
      ).rejects.toThrow(v.ValiError);
    await expect(
      eden.runtime.effects.run(
        eden.runtime.daemons.setEnabled(appId, "false" as never),
      ),
    ).rejects.toThrow(v.ValiError);
    for (const invoke of [
      () => eden.runtime.effects.run(eden.runtime.daemons.start("")),
      () =>
        eden.runtime.effects.run(eden.runtime.daemons.stop(undefined as never)),
      () => eden.runtime.effects.run(eden.runtime.daemons.restart(5 as never)),
    ])
      await expect(invoke()).rejects.toThrow(v.ValiError);
    expect(() => eden.runtime.daemons.onChanged({} as never)).toThrow(
      v.ValiError,
    );
    expect(
      (await eden.runtime.effects.run(eden.runtime.daemons.list()))[0]
        .definition,
    ).toEqual(definition);
    expect(eden.runtime.operations.list()).toEqual([]);
  });

  it("delivers detached daemon statuses from app commands under host authority and removes callbacks idempotently", async () => {
    eden = await createTestEden();
    const appId = "app.sdk-callback-daemon";
    const management = "app.sdk-daemon-management";
    eden.runtime.services.installedPackages.register(
      testApp(appId, {
        frontend: undefined,
        backend: { entry: "backend.js" },
      }),
    );
    const user = await eden.runtime.effects.run(
      eden.runtime.users.create({
        username: "worker",
        name: "Worker",
        password: "password",
        grants: ["*"],
      }),
    );
    eden.runtime.services.permissions.registerApp(management, [
      "daemon/manage",
    ]);
    const execution = eden.runtime.services.execution;
    const contexts: unknown[] = [];
    const off = eden.runtime.daemons.onChanged((status) => {
      contexts.push(execution.get());
      status.definition.enabled = true;
      status.name = "Changed by callback";
    });
    await eden.execute(
      "daemon/update-definition",
      {
        definition: {
          appId,
          enabled: false,
          runAs: { kind: "user", username: user.username },
          restart: "never",
        },
      },
      { appId: management, principal: { kind: "user", profile: user } },
    );
    expect(contexts).toEqual([{ principal: { kind: "system" } }]);
    expect(
      (await eden.runtime.effects.run(eden.runtime.daemons.list()))[0],
    ).toMatchObject({
      name: appId,
      definition: { enabled: false },
    });
    off();
    off();
    await eden.runtime.effects.run(
      eden.runtime.daemons.setEnabled(appId, true),
    );
    expect(contexts).toHaveLength(1);
    expect(
      (await eden.runtime.effects.run(eden.runtime.daemons.list()))[0]
        .definition.enabled,
    ).toBe(true);
  });

  it("delivers detached package reload events with host authority and preserves callback removal", async () => {
    eden = await createTestEden();
    const appId = "app.sdk-package-events";
    const source = path.join(eden.paths.appsDirectory, appId);
    await fs.mkdir(source);
    await fs.writeFile(
      path.join(source, "manifest.json"),
      JSON.stringify({
        id: appId,
        name: "Reloaded app",
        version: "1.0.0",
        frontend: { entry: "index.html" },
      }),
    );
    eden.runtime.services.installedPackages.register(testApp(appId));
    const execution = eden.runtime.services.execution;
    const contexts: unknown[] = [];
    const off = eden.runtime.packages.onChanged((change) => {
      contexts.push(execution.get());
      if (change.type === "upserted")
        change.manifest.name = "Changed by callback";
    });
    await eden.runtime.effects.run(
      execution.provide(eden.runtime.services.packages.reloadPackage(appId), {
        appId: "ambient.app",
        principal: { kind: "system" },
      }),
    );
    expect(contexts).toEqual([{ principal: { kind: "system" } }]);
    expect(eden.runtime.packages.get(appId)?.manifest.name).toBe(
      "Reloaded app",
    );
    off();
    off();
    await eden.runtime.effects.run(eden.runtime.packages.reload(appId));
    expect(contexts).toHaveLength(1);
  });

  it("restricts vendor daemon assignment at the app boundary while trusted SDK control remains independent of login", async () => {
    eden = await createTestEden({ autoStart: false });
    await fs.writeFile(
      path.join(eden.paths.distPath, "eden-seed.json"),
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
      }),
    );
    await eden.start();
    const appId = "app.sdk-vendor-daemon";
    const management = "app.sdk-vendor-management";
    eden.runtime.services.installedPackages.register(
      testApp(appId, {
        frontend: undefined,
        backend: { entry: "backend.js" },
      }),
    );
    eden.runtime.services.permissions.registerApp(management, [
      "daemon/manage",
      "settings/panels",
    ]);
    const standard = await eden.runtime.effects.run(
      eden.runtime.users.create({
        username: "standard",
        name: "Standard",
        password: "password",
        grants: ["preset/daemon/manage"],
      }),
    );
    const vendor = await eden.runtime.effects.run(
      eden.runtime.users.get("vendor"),
    );
    if (!vendor) throw new Error("Seeded vendor is missing");
    const definition: DaemonDefinition = {
      appId,
      enabled: false,
      runAs: { kind: "user", username: vendor.username },
      restart: "never",
    };
    const appUpdate = (profile: typeof standard) =>
      eden.execute(
        "daemon/update-definition",
        { definition },
        {
          appId: management,
          principal: { kind: "user", profile },
        },
      );
    await expect(appUpdate(standard)).rejects.toThrow(
      "Only a vendor can assign a vendor daemon principal",
    );
    expect(
      (await eden.runtime.effects.run(eden.runtime.daemons.list()))[0]
        .definition.runAs,
    ).toBeNull();
    const unchangedDefinition = (
      await eden.runtime.effects.run(eden.runtime.daemons.list())
    )[0].definition;
    await eden.runtime.effects.run(
      eden.runtime.sessions.login(standard.username, "password"),
    );
    await expect(
      eden.execute(
        "settings/action",
        {
          panelId: "eden.daemons",
          actionId: "update-definition",
          invocation: { value: { definition } },
        },
        {
          appId: management,
          principal: { kind: "user", profile: standard },
        },
      ),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "action_failed" },
    });
    expect(
      (await eden.runtime.effects.run(eden.runtime.daemons.list()))[0]
        .definition,
    ).toEqual(unchangedDefinition);
    await eden.runtime.effects.run(eden.runtime.sessions.logout());
    await expect(appUpdate(vendor)).resolves.toEqual({ success: true });
    expect(
      (await eden.runtime.effects.run(eden.runtime.daemons.list()))[0]
        .definition,
    ).toEqual(definition);
    await eden.runtime.effects.run(
      eden.runtime.daemons.updateDefinition({ ...definition, runAs: null }),
    );
    expect(eden.runtime.services.execution.get()).toBeUndefined();
    expect(eden.runtime.sessions.current()).toBeNull();
    await expect(
      eden.runtime.effects.run(
        eden.runtime.daemons.updateDefinition(definition),
      ),
    ).resolves.toBeUndefined();
    expect(
      (await eden.runtime.effects.run(eden.runtime.daemons.list()))[0]
        .definition,
    ).toEqual(definition);
  });
});
