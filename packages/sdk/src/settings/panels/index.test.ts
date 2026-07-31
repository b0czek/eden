import type { AppCatalog } from "../../app-registry";
import type { SettingsManager } from "../SettingsManager";
import {
  createSettingsPanelHarness as harness,
  panelUser as user,
} from "../SettingsPanelTestHarness";
import { registerBuiltinSettingsPanels } from "./index";

describe("SettingsPanelManager built-in providers", () => {
  it("delegates appearance, package, and daemon actions to domain managers", async () => {
    const { manager, settings, catalog, notify } = harness(
      user([
        "preset/appearance/manage",
        "preset/package/manage",
        "preset/daemon/manage",
      ]),
    );
    const appearance = {
      getPresets: jest.fn(() => ({ solid: [], gradients: [] })),
      getWallpaper: jest.fn(async () => ({
        id: "midnight",
        name: "Midnight",
        type: "color" as const,
        value: "#000",
      })),
      setWallpaper: jest.fn(async () => undefined),
      on: jest.fn(),
    };
    const packages = {
      isHotReloadEnabled: jest.fn(async () => false),
      toggleHotReload: jest.fn(async () => true),
      uninstallApp: jest.fn(async () => true),
      on: jest.fn(),
    };
    let daemonChanged: (() => void) | undefined;
    const daemons = {
      list: jest.fn(async () => []),
      updateDefinition: jest.fn(async () => undefined),
      setEnabled: jest.fn(async () => undefined),
      start: jest.fn(async () => undefined),
      stop: jest.fn(async () => undefined),
      restart: jest.fn(async () => undefined),
      on: jest.fn((event: string, listener: () => void) => {
        if (event === "changed") daemonChanged = listener;
        return jest.fn();
      }),
    };
    const users = { listUsers: jest.fn(async () => []) };

    registerBuiltinSettingsPanels({
      panels: manager,
      settings: settings as unknown as SettingsManager,
      appCatalog: catalog as unknown as AppCatalog,
      appearanceManager: appearance as never,
      packageManager: packages as never,
      daemonManager: daemons as never,
      userManager: users as never,
      config: {},
    });
    manager.connectLifecycle(
      { on: jest.fn() } as never,
      { on: jest.fn() } as never,
      daemons as never,
    );

    await manager.invokeAction("eden.appearance", "set-wallpaper", {
      wallpaper: { type: "preset", id: "midnight" },
    });
    await manager.invokeAction("eden.apps", "set-autostart", {
      appId: "com.example",
      enabled: true,
    });
    await manager.invokeAction("eden.apps", "toggle-hot-reload", {
      appId: "com.example",
    });
    await manager.invokeAction("eden.daemons", "start", {
      appId: "com.daemon",
    });

    expect(appearance.setWallpaper).toHaveBeenCalledWith({
      type: "preset",
      id: "midnight",
    });
    expect(settings.set).toHaveBeenCalledWith(
      "com.eden",
      "autostart.com.example",
      "true",
    );
    expect(packages.toggleHotReload).toHaveBeenCalledWith("com.example");
    expect(daemons.start).toHaveBeenCalledWith("com.daemon");
    daemonChanged?.();
    expect(notify).toHaveBeenCalledWith("settings/panels-changed", {
      reason: "state",
    });
  });
});
