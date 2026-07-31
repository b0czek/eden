import type { SettingsPanelManager } from "../settings";
import type { EdenSettingsApi } from "./EdenSettingsApi";

export function createSettingsApi(
  settingsPanelManager: SettingsPanelManager,
): EdenSettingsApi {
  return {
    registerPanel: (definition, provider, options) =>
      settingsPanelManager.registerPanel(definition, provider, options),
  };
}
