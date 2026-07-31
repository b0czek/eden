import type {
  SettingsCategory,
  SettingsPanelDeclaration,
  SettingsPanelProvider,
  SettingsPanelSummary,
} from "@edenapp/types";
import type { InternalPanelDefinition } from "./SettingsPanelCodec";

export type PanelRenderer = SettingsPanelDeclaration["renderer"];
export type PanelSource = SettingsPanelSummary["source"];

export interface SettingsPanelRecord {
  definition: InternalPanelDefinition;
  provider: SettingsPanelProvider;
  source: PanelSource;
  renderer: PanelRenderer;
  ownerAppId?: string;
  generatedSettings?: SettingsCategory[];
  token: symbol;
  visible: boolean;
}
