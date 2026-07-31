import type { RuntimeAppManifest, SettingsPanelValue } from "@edenapp/types";
import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import type { LoadedPanel } from "../../types";
import AppsTab from "./AppsTab";

const manifest = {
  id: "com.example.app",
  name: "Example",
  version: "1.0.0",
  isPrebuilt: false,
  isDevelopment: false,
  isCore: false,
  isRestricted: false,
  resolvedGrants: [],
} as unknown as RuntimeAppManifest;

describe("AppsTab", () => {
  it("loads an app size only after that app is selected", async () => {
    const shellCommand = vi.fn(async () => ({ size: 42 }));
    Object.defineProperty(window, "edenAPI", {
      configurable: true,
      value: { shellCommand },
    });
    const [busy] = createSignal(new Set<string>());
    const panel: LoadedPanel = {
      declaration: {
        id: "eden.apps",
        title: "Apps",
        source: "eden",
        renderer: "apps",
        sections: [],
        actions: [],
      },
      state: {
        data: {
          apps: [{ manifest, hotReload: false, autostart: false }],
          development: false,
        } as unknown as SettingsPanelValue,
      },
    };
    const view = render(() => (
      <AppsTab
        panel={panel}
        busyActions={busy}
        onAction={vi.fn(async () => ({ success: true }))}
      />
    ));

    expect(shellCommand).not.toHaveBeenCalled();
    await fireEvent.click(view.getByText("Example"));
    await waitFor(() =>
      expect(shellCommand).toHaveBeenCalledWith("package/get-size", {
        appId: manifest.id,
      }),
    );
  });
});
