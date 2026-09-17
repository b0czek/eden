import type { SettingsPanelView } from "@edenapp/types";
import {
  cloneAndValidatePanelActionInvocation,
  cloneAndValidatePanelDefinition,
  cloneAndValidatePanelView,
  validatePanelProvider,
} from "./SettingsPanelCodec";
import { panelDefinition } from "./SettingsPanelTestHarness";

const definition = () =>
  panelDefinition({
    actions: [
      {
        id: "button",
        params: {
          type: "object",
          required: true,
          properties: { deviceId: { type: "string", required: true } },
          additionalProperties: false,
        },
      },
      { id: "toggle", value: { type: "boolean", required: true } },
      {
        id: "dialog",
        fields: {
          type: "object",
          required: true,
          properties: { password: { type: "string", required: true } },
          additionalProperties: false,
        },
      },
    ],
  });

const view = (): SettingsPanelView => ({
  sections: [
    {
      id: "main",
      nodes: [
        {
          kind: "status",
          id: "status",
          label: "Status",
          value: "Ready",
          badge: { label: "Online", tone: "success" },
        },
        {
          kind: "toggle",
          id: "toggle",
          label: "Enabled",
          value: true,
          action: { actionId: "toggle" },
        },
        {
          kind: "button",
          id: "button",
          label: "Reset",
          action: { actionId: "button", params: { deviceId: "one" } },
        },
        {
          kind: "input",
          input: "select",
          id: "mode",
          label: "Mode",
          value: "a",
          options: [{ value: "a", label: "A" }],
          action: { actionId: "button", params: { deviceId: "one" } },
        },
        {
          kind: "dialog",
          id: "dialog",
          label: "Password",
          buttonLabel: "Change",
          action: { actionId: "dialog" },
          dialog: {
            title: "Change",
            fields: [{ id: "password", label: "Password", input: "password" }],
            submitLabel: "Save",
            cancelLabel: "Cancel",
          },
        },
        {
          kind: "collection",
          id: "devices",
          label: "Devices",
          items: [
            {
              id: "one",
              title: "One",
              nodes: [
                {
                  kind: "status",
                  id: "health",
                  label: "Health",
                  value: "Good",
                },
                {
                  kind: "button",
                  id: "remove",
                  label: "Remove",
                  action: { actionId: "button", params: { deviceId: "one" } },
                },
                {
                  kind: "toggle",
                  id: "live",
                  label: "Live",
                  value: true,
                  action: { actionId: "toggle" },
                },
                {
                  kind: "dialog",
                  id: "secret",
                  label: "Secret",
                  buttonLabel: "Set",
                  action: { actionId: "dialog" },
                  dialog: {
                    title: "Set",
                    fields: [
                      { id: "password", label: "Password", input: "password" },
                    ],
                    submitLabel: "Save",
                    cancelLabel: "Cancel",
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
});

describe("SettingsPanelCodec", () => {
  it("accepts every resolved node kind and collection row primitive", () => {
    expect(cloneAndValidatePanelView(definition(), view())).toEqual(view());
  });

  it("strictly validates definitions and providers", () => {
    expect(() =>
      cloneAndValidatePanelDefinition({
        ...definition(),
        extra: true,
      } as never),
    ).toThrow("definition");
    expect(() =>
      cloneAndValidatePanelDefinition(
        panelDefinition({ actions: [{ id: "write", grant: "write" }] }),
      ),
    ).toThrow("requires a label");
    expect(() =>
      validatePanelProvider(definition(), {
        load: async () => ({ sections: [] }),
      }),
    ).toThrow("missing action");
  });

  it.each([
    [
      "duplicate sections",
      () => {
        const value = view();
        value.sections.push(value.sections[0] as never);
        return value;
      },
    ],
    [
      "duplicate nodes",
      () => {
        const value = view();
        value.sections[0]?.nodes.push(value.sections[0].nodes[0] as never);
        return value;
      },
    ],
    [
      "duplicate items",
      () => {
        const value = view();
        const node = value.sections[0]?.nodes[5];
        if (node?.kind === "collection")
          node.items.push(node.items[0] as never);
        return value;
      },
    ],
    [
      "duplicate row nodes",
      () => {
        const value = view();
        const node = value.sections[0]?.nodes[5];
        if (node?.kind === "collection")
          node.items[0]?.nodes.push(node.items[0].nodes[0] as never);
        return value;
      },
    ],
  ])("rejects %s", (_name, mutate) =>
    expect(() => cloneAndValidatePanelView(definition(), mutate())).toThrow(
      "view",
    ),
  );

  it("rejects wrong values, missing choices, password values, unknown properties, actions, and params", () => {
    const cases: unknown[] = [
      {
        sections: [
          {
            id: "main",
            nodes: [
              {
                kind: "toggle",
                id: "x",
                label: "X",
                value: "yes",
                action: { actionId: "toggle" },
              },
            ],
          },
        ],
      },
      {
        sections: [
          {
            id: "main",
            nodes: [
              {
                kind: "input",
                input: "select",
                id: "x",
                label: "X",
                value: "a",
                action: { actionId: "button", params: { deviceId: "one" } },
              },
            ],
          },
        ],
      },
      {
        sections: [
          {
            id: "main",
            nodes: [
              {
                kind: "dialog",
                id: "x",
                label: "X",
                buttonLabel: "X",
                action: { actionId: "dialog" },
                dialog: {
                  title: "X",
                  fields: [
                    {
                      id: "password",
                      label: "Password",
                      input: "password",
                      value: "secret",
                    },
                  ],
                  submitLabel: "X",
                  cancelLabel: "X",
                },
              },
            ],
          },
        ],
      },
      { sections: [], extra: true },
      {
        sections: [
          {
            id: "main",
            nodes: [
              {
                kind: "button",
                id: "x",
                label: "X",
                action: { actionId: "missing" },
              },
            ],
          },
        ],
      },
      {
        sections: [
          {
            id: "main",
            nodes: [
              {
                kind: "button",
                id: "x",
                label: "X",
                action: { actionId: "button", params: { deviceId: 4 } },
              },
            ],
          },
        ],
      },
    ];
    for (const candidate of cases)
      expect(() =>
        cloneAndValidatePanelView(definition(), candidate as SettingsPanelView),
      ).toThrow();
  });

  it("validates invocation channels independently with channel paths", () => {
    const action = definition().actions?.[0];
    if (!action) throw new Error("missing action");
    expect(
      cloneAndValidatePanelActionInvocation(
        { params: { deviceId: "one" } },
        action,
      ).failures,
    ).toEqual([]);
    expect(
      cloneAndValidatePanelActionInvocation(
        { params: { deviceId: 1 }, value: true },
        action,
      ).failures.map(({ path }) => path),
    ).toEqual(expect.arrayContaining(["params.deviceId", "value"]));
  });
});
