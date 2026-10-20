import type {
  SettingsCategory,
  SettingsPanelActionInvocation,
  SettingsPanelCustomSnapshot,
  SettingsPanelProviderContext,
  SettingsPanelSummary,
  SettingsPanelValue,
  SettingsPanelView,
} from "@edenapp/types";
import type * as Effect from "effect/Effect";
import type { InternalPanelDefinition } from "./codec";

export type PanelRenderer = "generic" | SettingsPanelCustomSnapshot["renderer"];
export type PanelSource = SettingsPanelSummary["source"];

export type InternalPanelLoad =
  | SettingsPanelView
  | { data?: SettingsPanelValue };
export interface InternalSettingsPanelProvider {
  load(
    context: SettingsPanelProviderContext,
  ): Effect.Effect<InternalPanelLoad, Error>;
  actions?: Record<
    string,
    (
      invocation: SettingsPanelActionInvocation,
      context: SettingsPanelProviderContext,
    ) => Effect.Effect<void, Error>
  >;
}

export interface SettingsPanelRecord {
  definition: InternalPanelDefinition;
  provider: InternalSettingsPanelProvider;
  source: PanelSource;
  renderer: PanelRenderer;
  ownerAppId?: string;
  generatedSettings?: SettingsCategory[];
  token: symbol;
  visible: boolean;
}
