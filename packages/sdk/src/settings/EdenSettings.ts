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
      {
        key: "general.interfaceScale",
        label: {
          en: "Interface Scale",
          pl: "Skala interfejsu",
        },
        type: "select",
        description: {
          en: "Adjust the size of interface elements",
          pl: "Dostosuj rozmiar elementów interfejsu",
        },
        options: [
          { label: "50%", value: "0.5" },
          { label: "75%", value: "0.75" },
          { label: "100%", value: "1.0" },
          { label: "125%", value: "1.25" },
          { label: "150%", value: "1.5" },
          { label: "175%", value: "1.75" },
          { label: "200%", value: "2.0" },
        ],
        defaultValue: "1.0",
      },
    ],
  },
  {
    id: "keyboard",
    name: {
      en: "Keyboard",
      pl: "Klawiatura",
    },
    icon: "keyboard",
    settings: [
      {
        key: "keyboard.enabled",
        label: {
          en: "Enable On-Screen Keyboard",
          pl: "Włącz klawiaturę ekranową",
        },
        type: "toggle",
        description: {
          en: "Show the on-screen keyboard when editable fields receive focus.",
          pl: "Pokazuj klawiaturę ekranową, gdy pola edycji otrzymują fokus.",
        },
        defaultValue: "true",
      },
      {
        key: "keyboard.placementMode",
        label: {
          en: "Placement Mode",
          pl: "Tryb położenia",
        },
        type: "select",
        description: {
          en: "Choose whether the on-screen keyboard docks to the bottom or stays movable.",
          pl: "Wybierz, czy klawiatura ekranowa ma być przypięta do dołu, czy pozostać ruchoma.",
        },
        options: [
          { label: { en: "Docked", pl: "Zadokowana" }, value: "docked" },
          { label: { en: "Floating", pl: "Pływająca" }, value: "floating" },
        ],
        defaultValue: "docked",
      },
      {
        key: "keyboard.showNumberRow",
        label: {
          en: "Show Number Row",
          pl: "Pokaż rząd cyfr",
        },
        type: "toggle",
        description: {
          en: "Keep the number row visible on text layouts.",
          pl: "Pozostaw widoczny rząd cyfr w układach tekstowych.",
        },
        defaultValue: "true",
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
