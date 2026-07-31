import type { SettingsPanelSummary } from "@edenapp/types";
import { fireEvent, render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import type { LoadedPanel } from "../types";
import SettingsContent from "./SettingsContent";
import SettingsSidebar from "./SettingsSidebar";

describe("Settings shell", () => {
  it("places Eden and host panels above application panels", () => {
    const panels: SettingsPanelSummary[] = [
      { id: "eden.general", title: "General", source: "eden" },
      { id: "acme.network", title: "Network", source: "host" },
      {
        id: "app.com.example",
        title: "Example App",
        source: "application",
      },
    ];
    const [selected] = createSignal<string | null>(null);
    const view = render(() => (
      <SettingsSidebar
        brandName={() => "Eden"}
        panels={() => panels}
        selectedPanelId={selected}
        onSelect={() => undefined}
      />
    ));
    const sectionTitles = Array.from(
      view.container.querySelectorAll(".eden-sidebar-section-title"),
    ).map((node) => node.textContent);
    const sections = view.container.querySelectorAll(".eden-sidebar-section");

    expect(sectionTitles).toEqual(["Eden", "Applications"]);
    expect(sections[0].textContent).toContain("General");
    expect(sections[0].textContent).toContain("Network");
    expect(sections[1].textContent).toContain("Example App");
  });

  it("renders loading and retryable errors", async () => {
    const retry = vi.fn(async () => undefined);
    const [loading, setLoading] = createSignal(true);
    const [error, setError] = createSignal<
      import("@edenapp/types").SettingsPanelError | null
    >(null);
    const view = render(() => (
      <SettingsContent
        loading={loading}
        loadedPanel={() => null}
        panelError={error}
        operationError={() => null}
        busyActions={() => new Set()}
        onAction={async () => ({ success: true })}
        onRetry={retry}
      />
    ));

    expect(view.container.textContent).toContain("Loading");
    setLoading(false);
    setError({ code: "load_failed", message: "Unavailable" });
    const button = view.getByText("Retry");
    await fireEvent.click(button);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("selects the renderer declared by the trusted backend", () => {
    const loaded: LoadedPanel = {
      declaration: {
        id: "eden.appearance",
        title: "Appearance",
        source: "eden",
        renderer: "appearance",
        sections: [],
        actions: [{ id: "set-wallpaper", authorized: true }],
      },
      state: {
        data: {
          presets: { solid: [], gradients: [] },
          wallpaper: {
            id: "midnight",
            name: "Midnight",
            type: "color",
            value: "#000000",
          },
        },
      },
    };
    const view = render(() => (
      <SettingsContent
        loading={() => false}
        loadedPanel={() => loaded}
        panelError={() => null}
        operationError={() => null}
        busyActions={() => new Set()}
        onAction={async () => ({ success: true })}
        onRetry={async () => undefined}
      />
    ));

    expect(view.container.textContent).toContain("Wallpaper");
    expect(view.container.textContent).toContain("Solid Colors");
  });
});
