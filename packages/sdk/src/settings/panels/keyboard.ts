import type { SettingsCategory } from "@edenapp/types";
import type { BuiltinPanelModule } from "./types";

export const keyboardSettingsCategory = {
  id: "keyboard",
  name: { en: "Keyboard", pl: "Klawiatura" },
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
        en: "Allow the on-screen keyboard to be shown from the shell and app controls.",
        pl: "Zezwalaj na wyświetlanie klawiatury ekranowej z poziomu powłoki i kontrolek aplikacji.",
      },
      defaultValue: "true",
    },
    {
      key: "keyboard.autoShowOnFocus",
      label: {
        en: "Show Automatically on Focus",
        pl: "Pokazuj automatycznie po fokusie",
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
      label: { en: "Placement Mode", pl: "Tryb położenia" },
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
      label: { en: "Show Number Row", pl: "Pokaż rząd cyfr" },
      type: "toggle",
      description: {
        en: "Keep the number row visible on text layouts.",
        pl: "Pozostaw widoczny rząd cyfr w układach tekstowych.",
      },
      defaultValue: "true",
    },
  ],
} satisfies SettingsCategory;

export const keyboardPanel: BuiltinPanelModule = {
  kind: "generated",
  category: keyboardSettingsCategory,
};
