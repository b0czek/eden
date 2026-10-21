import * as Effect from "effect/Effect";
import { panelDefinition } from "../../../../tests/support/settings/panels";
import {
  cloneAndValidatePanelDefinition,
  validatePanelProvider,
} from "./definition";

describe("settings panel definitions and providers", () => {
  it("strictly validates definitions and providers", () => {
    expect(() =>
      cloneAndValidatePanelDefinition(panelDefinition({ id: "bad id" })),
    ).toThrow("Invalid");
    expect(() =>
      cloneAndValidatePanelDefinition({
        ...panelDefinition(),
        extra: true,
      } as never),
    ).toThrow("definition");
    expect(() =>
      cloneAndValidatePanelDefinition(
        panelDefinition({ actions: [{ id: "write", grant: "write" }] }),
      ),
    ).toThrow("requires a label");
    expect(() =>
      validatePanelProvider(panelDefinition({ actions: [{ id: "button" }] }), {
        load: () => Effect.succeed({ sections: [] }),
      }),
    ).toThrow("missing action");
  });
});
