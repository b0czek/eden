export interface GrantPresetDefinition {
  /** Preset ID */
  id: string;
  /** Human-readable label */
  label: string | Record<string, string>;
  /** Optional description */
  description?: string | Record<string, string>;
  /** Permissions unlocked by this preset */
  permissions: string[];
}

export const GRANT_PRESET_LIST: GrantPresetDefinition[] = [
  {
    id: "package/manage",
    label: {
      en: "App management",
      pl: "Zarządzanie aplikacjami",
    },
    permissions: ["package/manage"],
  },
  {
    id: "appearance/manage",
    label: {
      en: "Appearance management",
      pl: "Zarządzanie wyglądem",
    },
    permissions: ["appearance/manage"],
  },
];
