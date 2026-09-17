import {
  actionAuthorization,
  applyActionAuthorization,
  canOpenPanel,
  collectPanelGrantOptions,
  hasUserGrant,
} from "./SettingsPanelAuthorization";
import type { SettingsPanelRecord } from "./SettingsPanelRecord";
import { panelDefinition, panelUser } from "./SettingsPanelTestHarness";

const record = (
  overrides: Partial<SettingsPanelRecord> = {},
): SettingsPanelRecord => ({
  definition: panelDefinition(),
  provider: {
    load: async () => ({ sections: [] }),
    actions: { toggle: async () => undefined },
  },
  source: "host",
  renderer: "generic",
  token: Symbol("panel"),
  visible: true,
  ...overrides,
});

describe("SettingsPanelAuthorization", () => {
  it("combines visibility, panel grants, ancestors, wildcards, and vendor access", () => {
    expect(canOpenPanel(record(), panelUser(["panels/network"]))).toBe(true);
    expect(canOpenPanel(record(), panelUser(["panels/*"]))).toBe(true);
    expect(canOpenPanel(record({ visible: false }), panelUser(["*"]))).toBe(
      false,
    );
    expect(
      canOpenPanel(record(), panelUser(["panels/network"]), [
        record({ visible: false }),
      ]),
    ).toBe(false);
    expect(hasUserGrant(panelUser([], { role: "vendor" }), "private")).toBe(
      true,
    );
  });

  it("authorizes actions and builds grants without loading providers", () => {
    const protectedRecord = record({
      definition: panelDefinition({
        actions: [
          {
            id: "toggle",
            label: "Change network",
            grant: "panels/network/write",
            value: { type: "boolean" },
          },
        ],
      }),
    });
    expect(
      actionAuthorization(protectedRecord, panelUser(["panels/network"])),
    ).toEqual([{ id: "toggle", authorized: false }]);
    expect(collectPanelGrantOptions([protectedRecord])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ grant: "panels/network", kind: "panel" }),
        expect.objectContaining({
          grant: "panels/network/write",
          label: "Change network",
          kind: "panel-action",
        }),
      ]),
    );
  });

  it("disables denied generic action nodes including collection rows", () => {
    const authorized = applyActionAuthorization(
      {
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
              {
                kind: "collection",
                id: "rows",
                label: "Rows",
                items: [
                  {
                    id: "one",
                    title: "One",
                    nodes: [
                      {
                        kind: "button",
                        id: "remove",
                        label: "Remove",
                        action: { actionId: "toggle" },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      new Map([["toggle", false]]),
    );
    expect(authorized.sections[0]?.nodes[0]).toMatchObject({ disabled: true });
    expect(authorized.sections[0]?.nodes[1]).toMatchObject({
      items: [{ nodes: [{ disabled: true }] }],
    });
  });
});
