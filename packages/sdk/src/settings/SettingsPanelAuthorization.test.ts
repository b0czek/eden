import {
  applyActionAuthorization,
  authorizePanelDeclaration,
  canOpenPanel,
  collectPanelGrantOptions,
  hasUserGrant,
} from "./SettingsPanelAuthorization";
import type { SettingsPanelRecord } from "./SettingsPanelRecord";
import { panelDefinition, panelUser } from "./SettingsPanelTestHarness";

const record = (overrides: Partial<SettingsPanelRecord> = {}) =>
  ({
    definition: panelDefinition(),
    provider: {
      load: async () => ({}),
      actions: { toggle: async () => undefined },
    },
    source: "host",
    renderer: "generic",
    token: Symbol("panel"),
    visible: true,
    ...overrides,
  }) satisfies SettingsPanelRecord;

describe("SettingsPanelAuthorization", () => {
  it("combines visibility, panel grants, wildcards, and vendor access", () => {
    expect(canOpenPanel(record(), panelUser(["panels/network"]))).toBe(true);
    expect(canOpenPanel(record(), panelUser(["panels/*"]))).toBe(true);
    expect(canOpenPanel(record({ visible: false }), panelUser(["*"]))).toBe(
      false,
    );
    expect(hasUserGrant(panelUser([], { role: "vendor" }), "private")).toBe(
      true,
    );
  });

  it("filters action authorization and produces grant options", () => {
    const protectedRecord = record({
      definition: panelDefinition({
        actions: [{ id: "toggle", grant: "panels/network/write" }],
      }),
    });
    expect(
      authorizePanelDeclaration(protectedRecord, panelUser(["panels/network"]))
        ?.actions,
    ).toEqual([{ id: "toggle", authorized: false }]);
    expect(collectPanelGrantOptions([protectedRecord])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ grant: "panels/network", kind: "panel" }),
        expect.objectContaining({
          grant: "panels/network/write",
          kind: "panel-action",
        }),
      ]),
    );
  });

  it("merges denied action state under a control's state key", () => {
    const declaration = authorizePanelDeclaration(
      record({
        definition: panelDefinition({
          sections: [
            {
              id: "main",
              controls: [
                {
                  kind: "toggle",
                  id: "network-toggle",
                  label: "Enabled",
                  stateKey: "enabled",
                  actionId: "toggle",
                },
              ],
            },
          ],
          actions: [{ id: "toggle", grant: "panels/network/write" }],
        }),
      }),
      panelUser(["panels/network"]),
    );
    if (!declaration) throw new Error("Expected an authorized panel");

    expect(
      applyActionAuthorization(
        {
          controls: {
            enabled: { value: true, detail: "Running" },
          },
        },
        declaration,
      ).controls,
    ).toEqual({
      enabled: { value: true, detail: "Running", disabled: true },
    });
  });
});
