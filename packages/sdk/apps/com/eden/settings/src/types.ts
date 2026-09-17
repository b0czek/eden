import type {
  SettingsPanelActionInvocation,
  SettingsPanelActionResponse,
  SettingsPanelSnapshot,
  SettingsPanelSummary,
} from "@edenapp/types";

export type LoadedPanel = SettingsPanelSnapshot;
export type PanelAction = (
  instancePath: string,
  actionId: string,
  invocation?: SettingsPanelActionInvocation,
) => Promise<SettingsPanelActionResponse>;
export type PanelCatalog = SettingsPanelSummary[];
