import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as Effect from "effect/Effect";
import * as v from "valibot";
import { createTestEden, type TestEden } from "../../support/create-test-eden";

let eden: TestEden;
afterEach(async () => {
  await eden?.dispose();
});

describe("volume and settings SDK controllers", () => {
  it("releases prepared volume removal when host operation admission is closed", async () => {
    eden = await createTestEden();
    const rootPath = path.join(eden.paths.root, "unaccepted-volume");
    await fs.mkdir(rootPath);
    let ejected = false;
    await eden.runtime.effects.run(
      eden.runtime.volumes.register(
        {
          id: "unaccepted",
          label: "Unaccepted",
          kind: "removable",
          rootPath,
        },
        {
          eject: () =>
            Effect.sync(() => {
              ejected = true;
            }),
        },
      ),
    );
    eden.runtime.services.operations.closeAdmission();
    const failure = await eden.runtime.effects.run(
      Effect.flip(eden.runtime.volumes.eject("unaccepted")),
    );
    expect(failure).toMatchObject({ _tag: "OperationAdmissionClosed" });
    expect(eden.runtime.volumes.list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "unaccepted", state: "ready" }),
      ]),
    );
    expect(eden.runtime.operations.list()).toEqual([]);
    expect(ejected).toBe(false);
  });

  it("rejects malformed volume inputs before changing mounted state or accepting an operation", async () => {
    eden = await createTestEden();
    const rootPath = path.join(eden.paths.root, "host-volume");
    await fs.mkdir(rootPath);
    const registration = {
      id: "host-volume",
      label: "Host volume",
      kind: "removable" as const,
      rootPath,
    };
    const original = eden.runtime.volumes.list();
    for (const input of [
      null,
      [],
      { ...registration, id: 42 },
      { ...registration, id: " " },
      { ...registration, id: "home" },
      { ...registration, label: " " },
      { ...registration, kind: "other" },
      { ...registration, rootPath: false },
      { ...registration, rootPath: "relative-mount" },
      { ...registration, readOnly: "true" },
      { ...registration, supportsWatch: "true" },
    ]) {
      await expect(
        eden.runtime.effects.run(eden.runtime.volumes.register(input as never)),
      ).rejects.toThrow(v.ValiError);
    }
    for (const options of [
      null,
      false,
      { eject: true },
      { ejectGroup: {} },
      { ejectGroup: "group-without-callback" },
      { ejectGroup: " ", eject: () => Effect.promise(async () => undefined) },
    ]) {
      await expect(
        eden.runtime.effects.run(
          eden.runtime.volumes.register(registration, options as never),
        ),
      ).rejects.toThrow(v.ValiError);
    }
    for (const id of [undefined, null, 42, {}, ""]) {
      await expect(
        eden.runtime.effects.run(eden.runtime.volumes.eject(id as never)),
      ).rejects.toThrow();
      expect(() => eden.runtime.volumes.unregister(id as never)).toThrow();
    }
    expect(eden.runtime.volumes.list()).toEqual(original);
    expect(eden.runtime.operations.list()).toEqual([]);
    expect(() => eden.runtime.volumes.onChanged(null as never)).toThrow();
  });

  it("snapshots volume grouping while preserving the eject callback owner and detached observer data", async () => {
    eden = await createTestEden();
    const rootPath = path.join(eden.paths.root, "grouped-volumes");
    await fs.mkdir(rootPath);
    let callbackOwner: unknown;
    const options = {
      ejectGroup: "physical-device",
      calls: 0,
      eject() {
        return Effect.sync(() => {
          callbackOwner = this;
          this.calls++;
        });
      },
    };
    const registration = {
      id: "partition-one",
      label: "One",
      kind: "removable" as const,
      rootPath,
    };
    const pending = eden.runtime.effects.run(
      eden.runtime.volumes.register(registration, options),
    );
    options.ejectGroup = "changed-after-registration";
    registration.label = "Changed after registration";
    const first = await pending;
    first.label = "Changed result";
    await eden.runtime.effects.run(
      eden.runtime.volumes.register(
        { ...registration, id: "partition-two", label: "Two" },
        {
          ejectGroup: "physical-device",
          eject: () => Effect.promise(async () => undefined),
        },
      ),
    );
    expect(
      eden.runtime.volumes
        .list()
        .find((volume) => volume.id === "partition-one")?.label,
    ).toBe("One");
    const removeListener = eden.runtime.volumes.onChanged((volumes) => {
      for (const volume of volumes) volume.label = "Changed by observer";
    });
    await eden.runtime.effects.run(eden.runtime.volumes.eject("partition-one"));
    removeListener();
    removeListener();
    expect(callbackOwner).toBe(options);
    expect(options.calls).toBe(1);
    expect(eden.runtime.volumes.list().map((volume) => volume.id)).toEqual([
      "home",
    ]);
    expect(eden.runtime.volumes.list()[0].label).toBe("Home");
  });

  it("validates pre-start panel registration and visibility capabilities while preserving provider this bindings", async () => {
    eden = await createTestEden({ autoStart: false });
    const definition = {
      id: "vendor.sdk-panel",
      title: { en: "Host panel" },
      actions: [{ id: "increment" }],
    };
    const provider = {
      count: 0,
      owners: [] as unknown[],
      load() {
        return Effect.sync(() => {
          this.owners.push(this);
          return {
            sections: [
              {
                id: "main",
                nodes: [
                  {
                    id: "count",
                    kind: "status" as const,
                    label: "Count",
                    value: String(this.count),
                  },
                ],
              },
            ],
          };
        });
      },
      actions: {
        increment(this: { count: number; owners: unknown[] }) {
          return Effect.sync(() => {
            this.owners.push(this);
            this.count++;
          });
        },
      },
    };
    for (const invalid of [
      null,
      { ...definition, id: 1 },
      { ...definition, title: [] },
    ]) {
      expect(() =>
        eden.runtime.settings.registerPanel(invalid as never, provider),
      ).toThrow();
    }
    for (const invalid of [
      null,
      { load: true },
      { load: provider.load, actions: null },
    ]) {
      expect(() =>
        eden.runtime.settings.registerPanel(definition, invalid as never),
      ).toThrow();
    }
    for (const options of [null, { visible: "true" }]) {
      expect(() =>
        eden.runtime.settings.registerPanel(
          definition,
          provider,
          options as never,
        ),
      ).toThrow();
    }
    const registration = eden.runtime.settings.registerPanel(
      definition,
      provider,
      { visible: false },
    );
    definition.title.en = "Changed after registration";
    await eden.start();
    const user = await eden.runtime.effects.run(
      eden.runtime.users.create({
        username: "sdk-panel-user",
        name: "SDK panel user",
        password: "password",
        grants: [],
      }),
    );
    await eden.runtime.effects.run(
      eden.runtime.sessions.login(user.username, "password"),
    );
    const panels = eden.runtime.services.settingsPanels;
    expect(() => registration.setVisible("true" as never)).toThrow();
    expect(
      (await eden.runtime.effects.run(panels.listPanels())).map(
        (panel) => panel.id,
      ),
    ).not.toContain(definition.id);
    registration.setVisible(true);
    const load = () =>
      eden.runtime.effects.run(panels.loadPanel(definition.id));
    expect(await load()).toMatchObject({
      panel: {
        title: { en: "Host panel" },
        view: { sections: [{ nodes: [{ value: "0" }] }] },
      },
    });
    await expect(
      eden.runtime.effects.run(
        panels.invokeAction(definition.id, "increment", {}),
      ),
    ).resolves.toEqual({ success: true });
    expect(await load()).toMatchObject({
      panel: { view: { sections: [{ nodes: [{ value: "1" }] }] } },
    });
    expect(provider.owners).toHaveLength(3);
    expect(provider.owners.every((owner) => owner === provider)).toBe(true);
    registration.unregister();
  });
});
