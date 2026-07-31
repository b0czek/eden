import type { SettingsPanelLocalizedText } from "./SettingsPanel";

export type UserGrantOptionKind =
  | "app-launch"
  | "preset"
  | "app-feature"
  | "panel"
  | "panel-action"
  | "setting";

/** One exact grant that a vendor can assign to a user. */
export interface UserGrantOption {
  grant: string;
  kind: UserGrantOptionKind;
  label: SettingsPanelLocalizedText;
  description?: SettingsPanelLocalizedText;
  ownerId?: string;
  ownerLabel?: SettingsPanelLocalizedText;
}

export interface UserGrantOptionsResponse {
  revision: number;
  options: UserGrantOption[];
}
