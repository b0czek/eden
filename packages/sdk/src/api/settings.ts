import type {
  SettingsPanelActionInvocation,
  SettingsPanelDefinition,
  SettingsPanelProviderContext,
  SettingsPanelRegistration,
  SettingsPanelRegistrationOptions,
  SettingsPanelView,
} from "@edenapp/types";

import type * as Effect from "effect/Effect";

export type SettingsPanelLoader = (
  context: SettingsPanelProviderContext,
) => Effect.Effect<SettingsPanelView, Error>;
export type SettingsPanelActionHandler = (
  invocation: SettingsPanelActionInvocation,
  context: SettingsPanelProviderContext,
) => Effect.Effect<void, Error>;
export interface SettingsPanelProvider {
  load: SettingsPanelLoader;
  actions?: Record<string, SettingsPanelActionHandler>;
}

/** Trusted main-process registration surface exposed as `eden.settings`. */
export interface EdenSettingsApi {
  registerPanel(
    definition: SettingsPanelDefinition,
    provider: SettingsPanelProvider,
    options?: SettingsPanelRegistrationOptions,
  ): SettingsPanelRegistration;
}
