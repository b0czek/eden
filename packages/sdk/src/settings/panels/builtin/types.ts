import type {
  EdenConfig,
  SettingsCategory,
  SettingsPanelActionDefinition,
  SettingsPanelCustomSnapshot,
  SettingsPanelProviderContext,
  SettingsPanelValue,
} from "@edenapp/types";
import type * as Effect from "effect/Effect";
import type { SettingsPanelActionHandler } from "../../../api/settings";

import type { Appearance } from "../../../appearance/service";
import type { Daemons } from "../../../daemon/service";
import type { Packages } from "../../../packages/service";
import type { Users } from "../../../user/service";
import type { Settings } from "../../service";
import type { SettingsPanels } from "../service";

export interface BuiltinSettingsDependencies {
  panels: SettingsPanels;
  settings: Settings;
  appearance: Appearance;
  packages: Packages;
  daemons: Daemons;
  users: Users;
  config: EdenConfig;
}

type CustomPanelRenderer = SettingsPanelCustomSnapshot["renderer"];

export interface GeneratedBuiltinPanel {
  kind: "generated";
  category: SettingsCategory;
}

export interface CustomBuiltinPanel {
  kind: "custom";
  category: SettingsCategory & { view: CustomPanelRenderer };
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
