import type { EventData } from "@edenapp/types";
import type { EdenAPI } from "@edenapp/types/ipc";
import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Settings app transport", () => {
  it("refreshes selected state and clears a panel removed from the catalog", async () => {
    let catalog = [
      {
        id: "eden.general",
        title: "General",
        source: "eden" as const,
      },
    ];
    let changed:
      | ((event?: EventData<"settings/panels-changed">) => void)
      | undefined;
    let panelReads = 0;
    let catalogReads = 0;
    let panelValue = false;
    let holdPanelRefresh = false;
    let releasePanelRefresh: (() => void) | undefined;
    const shellCommand = vi.fn(async (command: string) => {
      if (command === "system/branding") return { name: "Eden" };
      if (command === "settings/panels") {
        catalogReads += 1;
        return { panels: catalog };
      }
      if (command === "settings/panel") {
        panelReads += 1;
        if (holdPanelRefresh) {
          await new Promise<void>((resolve) => {
            releasePanelRefresh = resolve;
          });
        }
        return {
          panel: {
            id: "eden.general",
            title: "General",
            source: "eden",
            renderer: "generic",
            sections: [
              {
                id: "main",
                controls: [
                  {
                    kind: "toggle",
                    id: "enabled",
                    label: "Enabled",
                    stateKey: "enabled",
                    actionId: "toggle",
                  },
                ],
              },
            ],
            actions: [{ id: "toggle", authorized: true }],
          },
          state: { controls: { enabled: { value: panelValue } } },
        };
      }
      if (command === "settings/action") return { success: true };
      throw new Error(`Unexpected command ${command}`);
    });
    window.edenAPI = {
      shellCommand,
      subscribe: vi.fn(async (_event, callback) => {
        changed = callback as (
          event?: EventData<"settings/panels-changed">,
        ) => void;
      }),
      unsubscribe: vi.fn(),
      isEventSupported: vi.fn(async () => true),
      getLaunchArgs: () => [],
    } as unknown as EdenAPI;

    const view = render(() => <App />);
    await waitFor(() => expect(view.getByText("General")).toBeTruthy());
    await fireEvent.click(view.getByText("General"));
    await waitFor(() => expect(view.getByText("Enabled")).toBeTruthy());

    const toggle = view.container.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    if (!toggle) throw new Error("Expected generated toggle");
    holdPanelRefresh = true;
    void fireEvent.change(toggle, { target: { checked: true } });
    await waitFor(() => expect(panelReads).toBeGreaterThan(1));
    expect(view.getByText("Enabled")).toBeTruthy();
    expect(view.container.textContent).not.toContain("Loading");
    holdPanelRefresh = false;
    releasePanelRefresh?.();
    await waitFor(() =>
      expect(
        view.container.querySelector<HTMLInputElement>(
          'input[type="checkbox"]',
        ),
      ).toBe(toggle),
    );
    expect(shellCommand).toHaveBeenCalledWith(
      "settings/action",
      expect.objectContaining({
        panelId: "eden.general",
        actionId: "toggle",
      }),
    );

    const panelReadsBeforeInvalidation = panelReads;
    const catalogReadsBeforeInvalidation = catalogReads;
    await changed?.({ reason: "state", panelId: "vendor.other" });
    expect(panelReads).toBe(panelReadsBeforeInvalidation);
    expect(catalogReads).toBe(catalogReadsBeforeInvalidation);

    panelValue = true;
    await changed?.({ reason: "state", panelId: "eden.general" });
    await waitFor(() => expect(toggle.checked).toBe(true));
    expect(
      view.container.querySelector<HTMLInputElement>('input[type="checkbox"]'),
    ).toBe(toggle);
    expect(catalogReads).toBe(catalogReadsBeforeInvalidation);

    catalog = [];
    await changed?.({ reason: "catalog" });
    await waitFor(() =>
      expect(view.container.textContent).not.toContain("Enabled"),
    );
  });
});
