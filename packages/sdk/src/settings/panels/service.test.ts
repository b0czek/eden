import * as Effect from "effect/Effect";
import { createSettingsPanelHarness as harness } from "../../../tests/support/settings/panel-harness";
import {
  panelDefinition as definition,
  panelUser as user,
} from "../../../tests/support/settings/panels";
import { fromPromise } from "../../effects/io";

const emptyProvider = () => ({
  load: () => fromPromise(async () => ({ sections: [] })),
  actions: { toggle: () => fromPromise(async () => undefined) },
});

describe("SettingsPanels registration", () => {
  it("keeps child grants independent under a public parent", async () => {
    const { panels, setUser } = harness(user(["panels/display"]));
    const parent = panels.registerPanel(
      { id: "vendor.device", title: "Device" },
      { load: () => fromPromise(async () => ({ sections: [] })) },
    );
    panels.registerPanel(
      definition({
        id: "vendor.display",
        parentId: parent.panelId,
        grant: "panels/display",
        actions: [],
      }),
      { load: () => fromPromise(async () => ({ sections: [] })) },
    );
    panels.registerPanel(
      definition({
        id: "vendor.wifi",
        parentId: parent.panelId,
        grant: "panels/wifi",
        actions: [],
      }),
      { load: () => fromPromise(async () => ({ sections: [] })) },
    );

    expect(
      (await Effect.runPromise(panels.listPanels())).map(({ id }) => id),
    ).toEqual(["vendor.device", "vendor.display"]);
    expect(panels.listGrantOptions().map(({ grant }) => grant)).toEqual([
      "panels/display",
      "panels/wifi",
    ]);
    expect(
      await Effect.runPromise(panels.loadPanel("vendor.device")),
    ).toMatchObject({
      panel: { id: "vendor.device", view: { sections: [] } },
    });
    expect(
      await Effect.runPromise(panels.loadPanel("vendor.wifi")),
    ).toMatchObject({
      error: { code: "authorization" },
    });

    setUser(user(["panels/wifi"]));
    expect(
      (await Effect.runPromise(panels.listPanels())).map(({ id }) => id),
    ).toEqual(["vendor.device", "vendor.wifi"]);
    setUser(user([]));
    expect(
      (await Effect.runPromise(panels.listPanels())).map(({ id }) => id),
    ).toEqual(["vendor.device"]);
    expect(() => parent.unregister()).toThrow("child panel");
  });

  it("lets a grantless child inherit its parent's access", async () => {
    const { panels, setUser } = harness(user([]));
    const parent = panels.registerPanel(
      definition({ id: "vendor.root", grant: "panels/root", actions: [] }),
      { load: () => fromPromise(async () => ({ sections: [] })) },
    );
    panels.registerPanel(
      { id: "vendor.child", parentId: parent.panelId, title: "Child" },
      { load: () => fromPromise(async () => ({ sections: [] })) },
    );

    expect(await Effect.runPromise(panels.listPanels())).toEqual([]);
    setUser(user(["panels/root"]));
    expect(
      (await Effect.runPromise(panels.listPanels())).map(({ id }) => id),
    ).toEqual(["vendor.root", "vendor.child"]);
  });

  it("rejects reserved, duplicate, and cross-owner registrations", () => {
    const { panels } = harness();
    expect(() =>
      panels.registerPanel(definition({ id: "eden.private" }), emptyProvider()),
    ).toThrow("reserved");
    panels.registerPanel(definition(), emptyProvider());
    expect(() => panels.registerPanel(definition(), emptyProvider())).toThrow(
      "already registered",
    );
    expect(() =>
      panels.registerBuiltinPanel(
        {
          id: "eden.child",
          parentId: "vendor.network",
          title: "Child",
          grant: "child",
          actions: [],
        },
        { load: () => fromPromise(async () => ({ sections: [] })) },
      ),
    ).toThrow("ownership domain");
  });

  it("deep-copies metadata, invalidates one snapshot, and keeps registration lifetimes independent", async () => {
    const { panels, notify } = harness();
    const source = definition();
    const registration = panels.registerPanel(source, emptyProvider());
    source.title = "Changed";
    expect((await Effect.runPromise(panels.listPanels()))[0]?.title).toEqual({
      en: "Network",
    });
    notify.mockClear();
    registration.invalidate();
    expect(notify).toHaveBeenCalledWith({
      reason: "state",
      panelId: registration.panelId,
    });
    registration.unregister();
    registration.unregister();
    expect(await Effect.runPromise(panels.listPanels())).toEqual([]);
  });

  it("requires visible, authorized ancestors at arbitrary depth and rejects parent removal", async () => {
    const { panels, setUser } = harness();
    const parent = panels.registerPanel(
      definition({ id: "vendor.root", actions: [] }),
      { load: () => fromPromise(async () => ({ sections: [] })) },
    );
    const child = panels.registerPanel(
      definition({
        id: "vendor.child",
        parentId: parent.panelId,
        grant: "panels/child",
        actions: [],
      }),
      { load: () => fromPromise(async () => ({ sections: [] })) },
    );
    const grandchild = panels.registerPanel(
      definition({
        id: "vendor.grandchild",
        parentId: child.panelId,
        grant: "panels/grandchild",
        actions: [],
      }),
      { load: () => fromPromise(async () => ({ sections: [] })) },
    );
    setUser(user(["panels/network", "panels/child", "panels/grandchild"]));
    expect(await Effect.runPromise(panels.listPanels())).toHaveLength(3);
    child.setVisible(false);
    expect(
      (await Effect.runPromise(panels.listPanels())).map(({ id }) => id),
    ).toEqual(["vendor.root"]);
    expect(
      await Effect.runPromise(panels.loadPanel(grandchild.panelId)),
    ).toMatchObject({
      error: { code: "authorization" },
    });
    child.setVisible(true);
    expect(() => parent.unregister()).toThrow("child panel");
    grandchild.unregister();
    child.unregister();
    parent.unregister();
  });
});

describe("SettingsPanels snapshots and actions", () => {
  it("assembles generic snapshots, validates dynamic bindings, and disables denied nodes", async () => {
    const { panels } = harness();
    panels.registerPanel(
      definition({
        actions: [
          {
            id: "toggle",
            label: "Toggle",
            grant: "panels/network/write",
            value: { type: "boolean", required: true },
          },
        ],
      }),
      {
        load: () =>
          fromPromise(async () => ({
            sections: [
              {
                id: "main",
                nodes: [
                  {
                    kind: "toggle",
                    id: "enabled",
                    label: "Enabled",
                    value: true,
                    action: { actionId: "toggle" },
                  },
                ],
              },
            ],
          })),
        actions: { toggle: () => fromPromise(async () => undefined) },
      },
    );
    expect(
      await Effect.runPromise(panels.loadPanel("vendor.network")),
    ).toMatchObject({
      panel: {
        renderer: "generic",
        view: { sections: [{ nodes: [{ disabled: true }] }] },
      },
    });
  });

  it("validates params, value, and fields independently without collisions", async () => {
    const { panels } = harness();
    const handler = jest.fn(() => Effect.void);
    panels.registerPanel(
      definition({
        actions: [
          {
            id: "toggle",
            params: {
              type: "object",
              required: true,
              properties: { value: { type: "string", required: true } },
              additionalProperties: false,
            },
            value: { type: "boolean", required: true },
          },
        ],
      }),
      {
        load: () =>
          fromPromise(async () => ({
            sections: [
              {
                id: "main",
                nodes: [
                  {
                    kind: "toggle",
                    id: "enabled",
                    label: "Enabled",
                    value: true,
                    action: {
                      actionId: "toggle",
                      params: { value: "provider" },
                    },
                  },
                ],
              },
            ],
          })),
        actions: { toggle: handler },
      },
    );
    expect(
      await Effect.runPromise(
        panels.invokeAction("vendor.network", "toggle", {
          params: { value: "provider" },
          value: true,
        }),
      ),
    ).toEqual({ success: true });
    expect(handler).toHaveBeenCalledWith(
      { params: { value: "provider" }, value: true },
      expect.anything(),
    );
    const invalid = await Effect.runPromise(
      panels.invokeAction("vendor.network", "toggle", {
        params: { value: 1 },
        value: "yes",
        fields: {},
      }),
    );
    expect(invalid.error?.fields).toEqual(
      expect.objectContaining({
        "params.value": expect.any(String),
        value: expect.any(String),
        fields: expect.any(String),
      }),
    );
  });

  it("rejects unknown invocation members before the callback", async () => {
    const { panels } = harness();
    const handler = jest.fn();
    panels.registerPanel(definition(), {
      load: () => fromPromise(async () => ({ sections: [] })),
      actions: { toggle: handler },
    });
    const result = await Effect.runPromise(
      panels.invokeAction("vendor.network", "toggle", {
        value: true,
        unexpected: true,
      } as never),
    );
    expect(result).toMatchObject({
      success: false,
      error: { code: "validation" },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("preserves session checks around loads and actions", async () => {
    const { panels, setSession } = harness();
    let finish: ((value: { sections: [] }) => void) | undefined;
    const pending = new Promise<{ sections: [] }>((resolve) => {
      finish = resolve;
    });
    panels.registerPanel(definition(), {
      load: () => fromPromise(() => pending),
      actions: { toggle: () => fromPromise(async () => undefined) },
    });
    const result = Effect.runPromise(panels.loadPanel("vendor.network"));
    setSession("session-2");
    finish?.({ sections: [] });
    expect(await result).toMatchObject({ error: { code: "session_changed" } });
  });
});
