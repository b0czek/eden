import type {
  EdenConfig,
  SettingsCategory,
  SettingsPanelActionDefinition,
  SettingsPanelActionHandler,
  SettingsPanelCustomSnapshot,
  SettingsPanelProviderContext,
  SettingsPanelValue,
} from "@edenapp/types";
import type { AppearanceManager } from "../../appearance/AppearanceManager";
import type { DaemonManager } from "../../daemon";
import type { PackageManager } from "../../package-manager";
import type { UserManager } from "../../user";
import type { SettingsManager } from "../SettingsManager";
import type { SettingsPanelManager } from "../SettingsPanelManager";

export interface BuiltinSettingsDependencies {
  panels: SettingsPanelManager;
  settings: SettingsManager;
  appearanceManager: AppearanceManager;
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
  ) => { data?: SettingsPanelValue } | Promise<{ data?: SettingsPanelValue }>;
}

export type BuiltinPanelAction = Omit<SettingsPanelActionDefinition, "id"> & {
  handler(
    dependencies: BuiltinSettingsDependencies,
    ...args: Parameters<SettingsPanelActionHandler>
  ): ReturnType<SettingsPanelActionHandler>;
};

export type BuiltinPanelModule = GeneratedBuiltinPanel | CustomBuiltinPanel;
