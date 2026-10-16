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
import type { Daemons } from "../../daemon";
import type { Packages } from "../../packages";
import type { Users } from "../../user";
import type { SettingsPanels } from "../panel-service";
import type { Settings } from "../service";

export interface BuiltinSettingsDependencies {
  panels: SettingsPanels;
  settings: Settings;
  appearance: Appearance;
  packages: Packages;
  daemons: Daemons;
  users: Users;
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
