import type {
  SettingsCategory,
  SettingsPanelActionHandler,
  SettingsPanelCustomSnapshot,
  SettingsPanelProviderContext,
  SettingsPanelSummary,
  SettingsPanelValue,
  SettingsPanelView,
} from "@edenapp/types";
import type { InternalPanelDefinition } from "./SettingsPanelCodec";

export type PanelRenderer = "generic" | SettingsPanelCustomSnapshot["renderer"];
export type PanelSource = SettingsPanelSummary["source"];

export interface InternalSettingsPanelProvider {
  load(
    context: SettingsPanelProviderContext,
  ):
    | SettingsPanelView
    | { data?: SettingsPanelValue }
    | Promise<SettingsPanelView | { data?: SettingsPanelValue }>;
  actions?: Record<string, SettingsPanelActionHandler>;
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
