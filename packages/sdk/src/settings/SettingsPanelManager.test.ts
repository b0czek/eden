import {
  panelDefinition as definition,
  createSettingsPanelHarness as harness,
  panelUser as user,
} from "./SettingsPanelTestHarness";

describe("SettingsPanelManager registration", () => {
  it("rejects reserved, duplicate, malformed, and incomplete providers", () => {
    const { manager } = harness();
    const provider = {
      load: async () => ({ controls: {} }),
      actions: { toggle: async () => undefined },
    };

    expect(() =>
      manager.registerPanel(definition({ id: "eden.private" }), provider),
    ).toThrow("reserved");
    expect(() =>
      manager.registerPanel(definition({ id: "app.some-app" }), provider),
    ).toThrow("reserved");
    expect(() =>
      manager.registerPanel(definition({ id: "bad id" }), provider),
    ).toThrow("Invalid");
    expect(() =>
      manager.registerPanel(definition(), {
        load: async () => ({}),
      }),
    ).toThrow('missing action "toggle"');

    manager.registerPanel(definition(), provider);
    expect(() => manager.registerPanel(definition(), provider)).toThrow(
      "already registered",
    );
  });

  it("deep-copies declarations and unregisters idempotently", async () => {
    const { manager } = harness();
    const source = definition();
    const registration = manager.registerPanel(source, {
      load: async () => ({ controls: { enabled: { value: true } } }),
      actions: { toggle: async () => undefined },
    });
    source.title = "Changed";

    expect((await manager.listPanels())[0]?.title).toEqual({ en: "Network" });
    registration.unregister();
    registration.unregister();
    expect(await manager.listPanels()).toEqual([]);
  });

  it("keeps hidden panels declared while blocking discovery and callbacks", async () => {
    const { manager } = harness();
    const action = jest.fn();
    const registration = manager.registerPanel(
      definition({
        actions: [
          {
            id: "toggle",
            label: "Change network",
            grant: "panels/network/write",
          },
        ],
      }),
      { load: async () => ({}), actions: { toggle: action } },
      { visible: false },
    );

    expect(await manager.listPanels()).toEqual([]);
    expect(await manager.loadPanel(registration.panelId)).toMatchObject({
      error: { code: "authorization" },
    });
    expect(
      await manager.invokeAction(registration.panelId, "toggle", undefined),
    ).toMatchObject({ success: false, error: { code: "authorization" } });
    expect(action).not.toHaveBeenCalled();
    expect(manager.listGrantOptions()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ grant: "panels/network", kind: "panel" }),
        expect.objectContaining({
          grant: "panels/network/write",
          kind: "panel-action",
          label: "Change network",
        }),
      ]),
    );

    registration.setVisible(true);
    expect(await manager.listPanels()).toHaveLength(1);
    registration.unregister();
    expect(() => registration.setVisible(true)).toThrow("unregistered");
  });

  it("snapshots callbacks and returns renderer-safe state copies", async () => {
    const { manager } = harness();
    const original = jest.fn(async () => undefined);
    const replacement = jest.fn(async () => undefined);
    const state = {
      controls: { enabled: { value: true } },
      data: { privateHostData: "not rendered" },
    };
    const provider = {
      load: async () => state,
      actions: { toggle: original },
    };
    manager.registerPanel(definition(), provider);
    provider.actions.toggle = replacement;

    const loaded = await manager.loadPanel("vendor.network");
    expect(loaded.state?.data).toBeUndefined();
    expect(loaded.state?.controls?.enabled.value).toBe(true);
    if (loaded.state?.controls?.enabled) {
      loaded.state.controls.enabled.value = false;
    }
    expect((await manager.loadPanel("vendor.network")).state).toMatchObject({
      controls: { enabled: { value: true } },
    });

    await manager.invokeAction("vendor.network", "toggle", { value: true });
    expect(original).toHaveBeenCalledTimes(1);
    expect(replacement).not.toHaveBeenCalled();
  });
});

describe("SettingsPanelManager authorization and callbacks", () => {
  it("requires the panel and action grants together", async () => {
    const { manager, setUser } = harness();
    const action = jest.fn();
    manager.registerPanel(
      definition({
        actions: [
          {
            id: "toggle",
            grant: "panels/network/write",
            input: {
              type: "object",
              properties: { value: { type: "boolean", required: true } },
              additionalProperties: false,
            },
          },
        ],
      }),
      {
        load: async () => ({}),
        actions: { toggle: action },
      },
    );

    expect(
      await manager.invokeAction("vendor.network", "toggle", { value: true }),
    ).toMatchObject({ success: false, error: { code: "authorization" } });
    expect(action).not.toHaveBeenCalled();

    setUser(user(["panels/network", "panels/network/write"]));
    expect(
      await manager.invokeAction("vendor.network", "toggle", { value: true }),
    ).toEqual({ success: true });
    expect(action).toHaveBeenCalledTimes(1);

    setUser(user(["panels/network/write"]));
    expect(await manager.listPanels()).toEqual([]);
  });

  it("validates input before invoking a private callback", async () => {
    const { manager } = harness();
    const action = jest.fn();
    manager.registerPanel(definition(), {
      load: async () => ({}),
      actions: { toggle: action },
    });

    const response = await manager.invokeAction("vendor.network", "toggle", {
      value: "yes",
      unexpected: true,
    });
    expect(response).toMatchObject({
      success: false,
      error: { code: "validation" },
    });
    expect(action).not.toHaveBeenCalled();
  });

  it("normalizes loader and action failures without exposing stacks", async () => {
    const { manager } = harness();
    manager.registerPanel(definition(), {
      load: async () => {
        throw new Error("secret loader details");
      },
      actions: {
        toggle: async () => {
          throw new Error("secret action details");
        },
      },
    });

    expect(await manager.loadPanel("vendor.network")).toMatchObject({
      error: {
        code: "load_failed",
        message: "The settings panel could not be loaded.",
      },
    });
    expect(
      await manager.invokeAction("vendor.network", "toggle", { value: true }),
    ).toMatchObject({
      success: false,
      error: {
        code: "action_failed",
        message: "The settings operation failed.",
      },
    });
  });

  it("discards a loader result after a mid-load session change", async () => {
    const { manager, setSession } = harness();
    let finish:
      | ((value: { controls: Record<string, never> }) => void)
      | undefined;
    const pending = new Promise<{
      controls: Record<string, never>;
    }>((resolve) => {
      finish = resolve;
    });
    manager.registerPanel(definition(), {
      load: () => pending,
      actions: { toggle: async () => undefined },
    });

    const result = manager.loadPanel("vendor.network");
    setSession("session-2");
    finish?.({ controls: {} });
    expect(await result).toMatchObject({
      error: { code: "session_changed" },
    });
  });

  it("discards a loader result when the panel is hidden mid-load", async () => {
    const { manager } = harness();
    let finish:
      | ((value: { controls: Record<string, never> }) => void)
      | undefined;
    const pending = new Promise<{ controls: Record<string, never> }>(
      (resolve) => {
        finish = resolve;
      },
    );
    const registration = manager.registerPanel(definition(), {
      load: () => pending,
      actions: { toggle: async () => undefined },
    });

    const result = manager.loadPanel(registration.panelId);
    registration.setVisible(false);
    finish?.({ controls: {} });

    expect(await result).toMatchObject({
      error: { code: "session_changed" },
    });
  });
});
