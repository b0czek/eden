import type { SettingsCategory } from "@edenapp/types";
import { appearancePanel } from "./appearance";
import { appsPanel } from "./apps";
import { daemonsPanel } from "./daemons";
import { generalPanel } from "./general";
import { keyboardPanel } from "./keyboard";
import type { BuiltinPanelModule, BuiltinSettingsDependencies } from "./types";

const BUILTIN_PANELS = [
  generalPanel,
  keyboardPanel,
  appearancePanel,
  appsPanel,
  daemonsPanel,
] satisfies BuiltinPanelModule[];

export const BUILTIN_SETTINGS_CATEGORIES: SettingsCategory[] =
  BUILTIN_PANELS.map((panel) => panel.category);

const registeredManagers = new WeakSet<BuiltinSettingsDependencies["panels"]>();

export function registerBuiltinSettingsPanels(
  dependencies: BuiltinSettingsDependencies,
): void {
  if (registeredManagers.has(dependencies.panels)) return;

  for (const panel of BUILTIN_PANELS) {
    if (panel.kind === "generated") {
      dependencies.panels.registerGeneratedBuiltinCategory(panel.category);
      continue;
    }
    const actions = Object.entries(panel.actions);
    dependencies.panels.registerBuiltinPanel(
      {
        id: `eden.${panel.category.id}`,
        title: panel.category.name,
        description: panel.category.description,
        icon: panel.category.icon,
        grant: panel.category.grant,
        sections: [],
        actions: actions.map(([id, { handler: _, ...definition }]) => ({
          id,
          ...definition,
        })),
      },
      {
        load: panel.createLoader(dependencies),
        actions: Object.fromEntries(
          actions.map(([id, { handler }]) => [
            id,
            (input, context) => handler(dependencies, input, context),
          ]),
        ),
      },
      panel.category.view,
    );
  }

  registeredManagers.add(dependencies.panels);
}

export type { BuiltinSettingsDependencies } from "./types";
