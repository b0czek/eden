import type { SettingsPanelActionDefinition } from "@edenapp/types";
import { cloneAndValidatePanelActionInvocation } from "./actions";

describe("settings panel actions", () => {
  it("validates invocation channels independently with channel paths", () => {
    const action: SettingsPanelActionDefinition = {
      id: "button",
      params: {
        type: "object",
        required: true,
        properties: { deviceId: { type: "string", required: true } },
        additionalProperties: false,
      },
    };
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
