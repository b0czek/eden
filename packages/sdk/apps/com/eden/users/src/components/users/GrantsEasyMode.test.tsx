import type { UserGrantOption } from "@edenapp/types";
import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import GrantsEasyMode from "./GrantsEasyMode";

vi.mock("../../i18n", () => ({
  locale: () => "en",
  getLocalizedValue: (value: string | Record<string, string>) =>
    typeof value === "string" ? value : (value.en ?? Object.values(value)[0]),
  t: (key: string) => key,
}));

const runtimePanel: UserGrantOption = {
  grant: "panels/runtime/use",
  kind: "panel",
  label: { en: "Runtime panel" },
};

describe("GrantsEasyMode", () => {
  it("renders live options and saves their exact grant keys", async () => {
    const [options, setOptions] = createSignal<UserGrantOption[]>([
      runtimePanel,
    ]);
    let grants = new Set<string>();
    const updateGrants = vi.fn(
      (updater: (current: Set<string>) => Set<string>) => {
        grants = updater(new Set(grants));
      },
    );
    const view = render(() => (
      <GrantsEasyMode
        grants={Array.from(grants)}
        isVendor={false}
        allowAllApps={false}
        allowAllSettings={false}
        options={options()}
        updateGrants={updateGrants}
      />
    ));

    const row = view.getByText("Runtime panel").closest("label");
    const toggle = row?.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    if (!toggle) throw new Error("Expected runtime grant toggle");
    await fireEvent.change(toggle, { target: { checked: true } });
    expect(grants).toEqual(new Set(["panels/runtime/use"]));

    setOptions([
      runtimePanel,
      {
        grant: "settings/com.example/new",
        kind: "setting",
        label: "New app setting",
      },
    ]);
    await waitFor(() => expect(view.getByText("New app setting")).toBeTruthy());
  });

  it("keeps non-settings panel grants visible under settings wildcard", () => {
    const view = render(() => (
      <GrantsEasyMode
        grants={["settings/*"]}
        isVendor={false}
        allowAllApps={false}
        allowAllSettings={true}
        options={[
          runtimePanel,
          {
            grant: "settings/com.example/covered",
            kind: "setting",
            label: "Covered setting",
          },
        ]}
        updateGrants={() => undefined}
      />
    ));

    expect(view.getByText("Runtime panel")).toBeTruthy();
    expect(view.queryByText("Covered setting")).toBeNull();
  });
});
