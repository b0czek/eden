import type { AppGrantDefinition } from "@edenapp/types";
import { GRANT_PRESET_LIST } from "./preset-list";
import { normalizeGrantPresets } from "./presets";

describe("GrantPresets", () => {
  it("normalizes app and preset grants and ignores unknown presets", () => {
    const warnSpy = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    const grants: AppGrantDefinition[] = [
      { scope: "preset", preset: "package/manage" },
      { scope: "preset", preset: "unknown/preset" },
      { scope: "app", id: "custom", label: "Custom" },
    ];

    const normalized = normalizeGrantPresets(grants, "com.eden.test");
    const preset = GRANT_PRESET_LIST.find(
      (item) => item.id === "package/manage",
    );
    if (!preset) {
      throw new Error("Expected package/manage preset to exist");
    }

    expect(normalized).toEqual([
      {
        scope: "preset",
        id: "package/manage",
        preset: "package/manage",
        label: preset.label,
        description: preset.description,
        permissions: ["package/manage"],
      },
      {
        scope: "app",
        id: "custom",
        label: "Custom",
        description: undefined,
        permissions: [],
      },
    ]);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });
});
