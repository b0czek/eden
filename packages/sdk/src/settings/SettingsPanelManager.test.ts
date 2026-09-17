import {
  panelDefinition as definition,
  createSettingsPanelHarness as harness,
  panelUser as user,
} from "./SettingsPanelTestHarness";

const emptyProvider = () => ({
  load: async () => ({ sections: [] }),
  actions: { toggle: async () => undefined },
});

describe("SettingsPanelManager registration", () => {
  it("rejects reserved, duplicate, malformed, incomplete, and cross-owner registrations", () => {
    const { manager } = harness();
    expect(() =>
      manager.registerPanel(
        definition({ id: "eden.private" }),
        emptyProvider(),
      ),
    ).toThrow("reserved");
    expect(() =>
      manager.registerPanel(definition({ id: "bad id" }), emptyProvider()),
    ).toThrow("Invalid");
    expect(() =>
      manager.registerPanel(definition(), {
        load: async () => ({ sections: [] }),
      }),
    ).toThrow("missing action");
    manager.registerPanel(definition(), emptyProvider());
    expect(() => manager.registerPanel(definition(), emptyProvider())).toThrow(
      "already registered",
    );
    expect(() =>
      manager.registerBuiltinPanel(
        {
          id: "eden.child",
          parentId: "vendor.network",
          title: "Child",
          grant: "child",
          actions: [],
        },
        { load: async () => ({ sections: [] }) },
      ),
    ).toThrow("ownership domain");
  });

  it("deep-copies metadata, invalidates one snapshot, and keeps registration lifetimes independent", async () => {
    const { manager, notify } = harness();
    const source = definition();
    const registration = manager.registerPanel(source, emptyProvider());
    source.title = "Changed";
    expect((await manager.listPanels())[0]?.title).toEqual({ en: "Network" });
    notify.mockClear();
    registration.invalidate();
    expect(notify).toHaveBeenCalledWith("settings/panels-changed", {
      reason: "state",
      panelId: registration.panelId,
    });
    registration.unregister();
    registration.unregister();
    expect(await manager.listPanels()).toEqual([]);
  });

  it("requires visible, authorized ancestors at arbitrary depth and rejects parent removal", async () => {
    const { manager, setUser } = harness();
    const parent = manager.registerPanel(
      definition({ id: "vendor.root", actions: [] }),
      { load: async () => ({ sections: [] }) },
    );
    const child = manager.registerPanel(
      definition({
        id: "vendor.child",
        parentId: parent.panelId,
        grant: "panels/child",
        actions: [],
      }),
      { load: async () => ({ sections: [] }) },
    );
    const grandchild = manager.registerPanel(
      definition({
        id: "vendor.grandchild",
        parentId: child.panelId,
        grant: "panels/grandchild",
        actions: [],
      }),
      { load: async () => ({ sections: [] }) },
    );
    setUser(user(["panels/network", "panels/child", "panels/grandchild"]));
    expect(await manager.listPanels()).toHaveLength(3);
    child.setVisible(false);
    expect((await manager.listPanels()).map(({ id }) => id)).toEqual([
      "vendor.root",
    ]);
    expect(await manager.loadPanel(grandchild.panelId)).toMatchObject({
      error: { code: "authorization" },
    });
    child.setVisible(true);
    expect(() => parent.unregister()).toThrow("child panel");
    grandchild.unregister();
    child.unregister();
    parent.unregister();
  });
});

describe("SettingsPanelManager snapshots and actions", () => {
  it("assembles generic snapshots, validates dynamic bindings, and disables denied nodes", async () => {
    const { manager } = harness();
    manager.registerPanel(
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
        load: async () => ({
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
        }),
        actions: { toggle: async () => undefined },
      },
    );
    expect(await manager.loadPanel("vendor.network")).toMatchObject({
      panel: {
        renderer: "generic",
        view: { sections: [{ nodes: [{ disabled: true }] }] },
      },
    });
  });

  it("validates params, value, and fields independently without collisions", async () => {
    const { manager } = harness();
    const handler = jest.fn();
    manager.registerPanel(
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
        load: async () => ({
          sections: [
            {
              id: "main",
              nodes: [
                {
                  kind: "toggle",
                  id: "enabled",
                  label: "Enabled",
                  value: true,
                  action: { actionId: "toggle", params: { value: "provider" } },
                },
              ],
            },
          ],
        }),
        actions: { toggle: handler },
      },
    );
    expect(
      await manager.invokeAction("vendor.network", "toggle", {
        params: { value: "provider" },
        value: true,
      }),
    ).toEqual({ success: true });
    expect(handler).toHaveBeenCalledWith(
      { params: { value: "provider" }, value: true },
      expect.anything(),
    );
    const invalid = await manager.invokeAction("vendor.network", "toggle", {
      params: { value: 1 },
      value: "yes",
      fields: {},
    });
    expect(invalid.error?.fields).toEqual(
      expect.objectContaining({
        "params.value": expect.any(String),
        value: expect.any(String),
        fields: expect.any(String),
      }),
    );
  });

  it("rejects unknown invocation members before the callback", async () => {
    const { manager } = harness();
    const handler = jest.fn();
    manager.registerPanel(definition(), {
      load: async () => ({ sections: [] }),
      actions: { toggle: handler },
    });
    const result = await manager.invokeAction("vendor.network", "toggle", {
      value: true,
      unexpected: true,
    } as never);
    expect(result).toMatchObject({
      success: false,
      error: { code: "validation" },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("preserves session checks around loads and actions", async () => {
    const { manager, setSession } = harness();
    let finish: ((value: { sections: [] }) => void) | undefined;
    const pending = new Promise<{ sections: [] }>((resolve) => {
      finish = resolve;
    });
    manager.registerPanel(definition(), {
      load: () => pending,
      actions: { toggle: async () => undefined },
    });
    const result = manager.loadPanel("vendor.network");
    setSession("session-2");
    finish?.({ sections: [] });
    expect(await result).toMatchObject({ error: { code: "session_changed" } });
  });
});
