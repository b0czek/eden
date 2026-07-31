import type {
  SettingsPanelDefinition,
  SettingsPanelProvider,
  SettingsPanelRegistration,
  SettingsPanelRegistrationOptions,
} from "@edenapp/types";

/** Trusted main-process registration surface exposed as `eden.settings`. */
export interface EdenSettingsApi {
  registerPanel(
    definition: SettingsPanelDefinition,
    provider: SettingsPanelProvider,
    options?: SettingsPanelRegistrationOptions,
  ): SettingsPanelRegistration;
}
