import type {
  EdenConfig,
  SettingsCategory,
  SettingsPanelActionDefinition,
  SettingsPanelActionHandler,
  SettingsPanelCustomSnapshot,
  SettingsPanelProviderContext,
  SettingsPanelValue,
} from "@edenapp/types";
import type { EffectRuntime } from "../../effects/runtime";
import type { Appearance } from "../../appearance/service";
import type { DaemonManager } from "../../daemon";
import type { PackageManager } from "../../package-manager";
import type { UserManager } from "../../user";
import { type LegacySettingsAccess } from "../legacy-access";
import type { SettingsPanelManager } from "../SettingsPanelManager";

export interface BuiltinSettingsDependencies {
  panels: SettingsPanelManager;
  settings: LegacySettingsAccess;
  appearance: Appearance;
  effects: EffectRuntime;
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
