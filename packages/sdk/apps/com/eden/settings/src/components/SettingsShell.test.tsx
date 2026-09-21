import type { SettingsPanelError, SettingsPanelSummary } from "@edenapp/types";
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
    const scrollArea = view.container.querySelector(".settings-sidebar-scroll");
    expect(scrollArea?.textContent).toContain("General");
    expect(scrollArea?.textContent).toContain("Example App");
    expect(
      view.container.querySelectorAll(".settings-sidebar-scroll").length,
    ).toBe(1);
    expect(
      view.getByRole("button", { name: "General" }).getAttribute("title"),
    ).toBe("General");
    expect(
      view.getByRole("button", { name: "Example App" }).getAttribute("title"),
    ).toBe("Example App");
  });

  it("renders loading and retryable errors", async () => {
    const retry = vi.fn(async () => undefined);
    const [loading, setLoading] = createSignal(true);
    const [error, setError] = createSignal<SettingsPanelError | null>(null);
    const view = render(() => (
      <SettingsContent
        loading={loading}
        panels={() => []}
        selectedPanelId={() => null}
        loadedPanel={() => null}
        panelError={error}
        operationError={() => null}
        busyActions={() => new Set()}
        onAction={async () => ({ success: true })}
        onSelect={() => undefined}
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
      id: "eden.appearance",
      title: "Appearance",
      source: "eden",
      renderer: "appearance",
      actions: [{ id: "set-wallpaper", authorized: true }],
      data: {
        presets: { solid: [], gradients: [] },
        wallpaper: {
          id: "midnight",
          name: "Midnight",
          type: "color",
          value: "#000000",
        },
      },
    };
    const view = render(() => (
      <SettingsContent
        loading={() => false}
        panels={() => []}
        selectedPanelId={() => "eden.appearance"}
        loadedPanel={() => loaded}
        panelError={() => null}
        operationError={() => null}
        busyActions={() => new Set()}
        onAction={async () => ({ success: true })}
        onSelect={() => undefined}
        onRetry={async () => undefined}
      />
    ));

    expect(view.container.textContent).toContain("Wallpaper");
    expect(view.container.textContent).toContain("Solid Colors");
  });

  it("keeps child panels out of the sidebar and navigates their hierarchy", async () => {
    const panels: SettingsPanelSummary[] = [
      { id: "host.network", title: "Network", source: "host" },
      {
        id: "host.network.connections",
        parentId: "host.network",
        title: "Connections",
        description: "Network interfaces",
        source: "host",
      },
    ];
    const selected = createSignal<string | null>("host.network");
    const loaded: LoadedPanel = {
      ...panels[0],
      renderer: "generic",
      view: { sections: [] },
      actions: [],
    };
    const sidebar = render(() => (
      <SettingsSidebar
        brandName={() => "Eden"}
        panels={() => panels}
        selectedPanelId={selected[0]}
        onSelect={selected[1]}
      />
    ));
    expect(sidebar.container.textContent).toContain("Network");
    expect(sidebar.container.textContent).not.toContain("Connections");

    const content = render(() => (
      <SettingsContent
        loading={() => false}
        panels={() => panels}
        selectedPanelId={selected[0]}
        loadedPanel={() => loaded}
        panelError={() => null}
        operationError={() => null}
        busyActions={() => new Set()}
        onAction={async () => ({ success: true })}
        onSelect={selected[1]}
        onRetry={async () => undefined}
      />
    ));
    expect(content.container.querySelector(".content-navigation")).toBeNull();
    await fireEvent.click(content.getByText("Connections"));
    expect(selected[0]()).toBe("host.network.connections");
    const childNavigation = content.container.querySelector(
      ".content-navigation",
    );
    expect(childNavigation?.textContent).toContain("Network");
    expect(childNavigation?.textContent).not.toContain("Connections");
    expect(childNavigation?.querySelector(".content-back")).not.toBeNull();
    expect(
      sidebar.container.querySelector(".eden-sidebar-item-selected")
        ?.textContent,
    ).toContain("Network");
  });
});
