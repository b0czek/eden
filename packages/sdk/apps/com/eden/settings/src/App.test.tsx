import type { EventData } from "@edenapp/types";
import type { EdenAPI } from "@edenapp/types/ipc";
import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Settings app transport", () => {
  it("sends cloneable brightness parameters from the reconciled panel", async () => {
    let brightness = 100;
    const received: unknown[] = [];
    const shellCommand = vi.fn(async (command: string, args: unknown) => {
      const request = structuredClone(args) as {
        invocation: { params: { output: string }; value: number };
      };
      if (command === "system/branding") return { name: "Eden" };
      if (command === "settings/panels") {
        return {
          panels: [{ id: "vendor.display", title: "Display", source: "host" }],
        };
      }
      if (command === "settings/panel") {
        return {
          panel: {
            id: "vendor.display",
            title: "Display",
            source: "host",
            renderer: "generic",
            view: {
              sections: [
                {
                  id: "brightness",
                  nodes: [
                    {
                      kind: "input",
                      input: "range",
                      id: "panel",
                      label: "Panel brightness",
                      value: brightness,
                      validation: { min: 0, max: 100, step: 1 },
                      action: {
                        actionId: "set-brightness",
                        params: { output: "eDP-1" },
                      },
                    },
                  ],
                },
              ],
            },
            actions: [{ id: "set-brightness", authorized: true }],
          },
        };
      }
      if (command === "settings/action") {
        received.push(request.invocation);
        brightness = request.invocation.value;
        return { success: true };
      }
      throw new Error(`Unexpected command ${command}`);
    });
    window.edenAPI = {
      shellCommand,
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      getLaunchArgs: () => [],
    } as unknown as EdenAPI;

    const view = render(() => <App />);
    await waitFor(() => expect(view.getByText("Display")).toBeTruthy());
    await fireEvent.click(view.getByText("Display"));
    await waitFor(() =>
      expect(view.getByText("Panel brightness")).toBeTruthy(),
    );
    const slider = view.getByLabelText("Panel brightness") as HTMLInputElement;
    await fireEvent.input(slider, { target: { value: "45" } });
    await fireEvent.change(slider);
    await waitFor(() =>
      expect(received).toEqual([{ params: { output: "eDP-1" }, value: 45 }]),
    );
    await waitFor(() => expect(slider.value).toBe("45"));
    expect(view.queryByRole("alert")).toBeNull();
  });

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
            view: {
              sections: [
                {
                  id: "main",
                  nodes: [
                    {
                      kind: "toggle",
                      id: "enabled",
                      label: "Enabled",
                      value: panelValue,
                      action: { actionId: "toggle" },
                    },
                  ],
                },
              ],
            },
            actions: [{ id: "toggle", authorized: true }],
          },
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
        invocation: { value: true },
      }),
      undefined,
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
