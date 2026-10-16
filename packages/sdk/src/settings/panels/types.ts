import type {
  EdenConfig,
  SettingsCategory,
  SettingsPanelActionDefinition,
  SettingsPanelActionHandler,
  SettingsPanelCustomSnapshot,
  SettingsPanelProviderContext,
  SettingsPanelValue,
} from "@edenapp/types";
import * as Effect from "effect/Effect";

import type { Appearance } from "../../appearance/service";
import type { DaemonManager } from "../../daemon";
import type { PackageManager } from "../../package-manager";
import type { UserManager } from "../../user";
import type { SettingsPanelManager } from "../SettingsPanelManager";
import type { Settings } from "../service";

export interface BuiltinSettingsDependencies {
  panels: SettingsPanelManager;
  settings: Settings;
  appearance: Appearance;
  packageManager: PackageManager;
  daemonManager: DaemonManager;
  userManager: UserManager;
  config: EdenConfig;
}

type PanelRenderer = SettingsPanelCustomSnapshot["renderer"];

export interface GeneratedBuiltinPanel {
  kind: "generated";
  category: SettingsCategory;
}

export interface CustomBuiltinPanel {
  kind: "custom";
  category: SettingsCategory & { view: PanelRenderer };
  actions: Record<string, BuiltinPanelAction>;
  createLoader(
    dependencies: BuiltinSettingsDependencies,
  ): (
    context: SettingsPanelProviderContext,
  ) => Effect.Effect<{ data?: SettingsPanelValue }, Error>;
}

export type BuiltinPanelAction = Omit<SettingsPanelActionDefinition, "id"> & {
  handler(
    dependencies: BuiltinSettingsDependencies,
    ...args: Parameters<SettingsPanelActionHandler>
  ): Effect.Effect<void, Error>;
};

export type BuiltinPanelModule = GeneratedBuiltinPanel | CustomBuiltinPanel;
