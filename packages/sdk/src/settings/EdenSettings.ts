import type { SettingsCategory } from "@edenapp/types";

/**
 * Eden System Settings Schema
 *
 * Defines the settings categories and individual settings for Eden itself.
 */
export const EDEN_SETTINGS_SCHEMA: SettingsCategory[] = [
  {
    id: "general",
    name: {
      en: "General",
      pl: "Ogólne",
    },
    icon: "settings",
    settings: [
      {
        key: "general.locale",
        label: {
          en: "Language",
          pl: "Język",
        },
        type: "select",
        description: {
          en: "System language",
          pl: "Język systemu",
        },
        options: [
          { label: "English", value: "en" },
          { label: "Polski", value: "pl" },
        ],
        defaultValue: "en",
      },
    ],
  },
  {
    id: "appearance",
    name: {
      en: "Appearance",
      pl: "Wygląd",
    },
    icon: "image",
    view: "appearance",
    grant: "preset/appearance/manage",
    grantScope: "global",
    settings: [
      {
        key: "appearance.wallpaper",
        label: {
          en: "Wallpaper",
          pl: "Tapeta",
        },
        type: "text",
        description: {
          en: "Choose your desktop background",
          pl: "Wybierz tło pulpitu",
        },
        defaultValue: '{"type":"preset","id":"eden-default"}',
      },
    ],
  },
  {
    id: "apps",
    name: {
      en: "Installed Apps",
      pl: "Zainstalowane aplikacje",
    },
    description: {
      en: "Manage installed applications, system services, and daemons.",
      pl: "Zarządzaj zainstalowanymi aplikacjami, usługami systemowymi i demonami.",
    },
    icon: "package",
    view: "apps",
    grant: "preset/package/manage",
    grantScope: "global",
    settings: [],
  },
];
