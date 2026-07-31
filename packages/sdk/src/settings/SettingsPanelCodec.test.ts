import type { SettingsPanelDefinition } from "@edenapp/types";
import {
  cloneAndValidatePanelDefinition,
  cloneRendererValue,
  validatePanelActionInput,
  validatePanelProvider,
} from "./SettingsPanelCodec";
import { panelDefinition } from "./SettingsPanelTestHarness";

describe("SettingsPanelCodec", () => {
  it("validates and clones renderer declarations", () => {
    const source = panelDefinition();
    const cloned = cloneAndValidatePanelDefinition(source);
    source.title = "Changed";

    expect(cloned.title).toEqual({ en: "Network" });
    expect(() =>
      cloneAndValidatePanelDefinition({
        ...panelDefinition(),
        sections: [{ id: "main", controls: "invalid" }],
      } as unknown as SettingsPanelDefinition),
    ).toThrow("Invalid settings panel declaration");
    expect(() => cloneRendererValue({ value: Number.NaN })).toThrow(
      "Non-finite",
    );
  });

  it("checks action relationships and provider callbacks", () => {
    expect(() =>
      cloneAndValidatePanelDefinition({
        ...panelDefinition(),
        actions: [],
      }),
    ).toThrow('undeclared action "toggle"');
    expect(() =>
      validatePanelProvider(panelDefinition(), { load: async () => ({}) }),
    ).toThrow('missing action "toggle"');
  });

  it("validates operation dialogs and keeps passwords dialog-local", () => {
    const definition = panelDefinition();
    definition.sections[0]?.controls.push({
      kind: "dialog",
      id: "ftp-password",
      label: "FTP password",
      buttonLabel: "Update password",
      actionId: "toggle",
      dialog: {
        title: "Update FTP password",
        fields: [{ id: "password", label: "FTP password", input: "password" }],
        submitLabel: "Save",
        cancelLabel: "Cancel",
      },
    });

    expect(() => cloneAndValidatePanelDefinition(definition)).not.toThrow();
    expect(() =>
      cloneAndValidatePanelDefinition({
        ...panelDefinition(),
        sections: [
          {
            id: "main",
            controls: [
              {
                kind: "input",
                id: "password",
                label: "Password",
                input: "password",
                stateKey: "password",
                actionId: "toggle",
              },
            ],
          },
        ],
      }),
    ).toThrow("must be component-local inside a dialog");
  });

  it("validates action values against recursive input declarations", () => {
    const schema = panelDefinition().actions?.[0]?.input;
    expect(validatePanelActionInput({ value: true }, schema)).toEqual([]);
    expect(validatePanelActionInput({ value: "yes" }, schema)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "input.value" }),
      ]),
    );
  });
});
