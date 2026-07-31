import type {
  SettingsPanelActionResponse,
  SettingsPanelDeclaration,
  SettingsPanelState,
  SettingsPanelSummary,
  SettingsPanelValue,
} from "@edenapp/types";

export interface LoadedPanel {
  declaration: SettingsPanelDeclaration;
  state: SettingsPanelState;
}

export type PanelAction = (
  actionId: string,
  input?: SettingsPanelValue,
) => Promise<SettingsPanelActionResponse>;

export type PanelCatalog = SettingsPanelSummary[];
