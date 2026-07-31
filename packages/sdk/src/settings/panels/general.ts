import type { SettingsCategory } from "@edenapp/types";
import type { BuiltinPanelModule } from "./types";

export const generalSettingsCategory = {
  id: "general",
  name: { en: "General", pl: "Ogólne" },
  icon: "settings",
  settings: [
    {
      key: "general.locale",
      label: { en: "Language", pl: "Język" },
      type: "select",
      description: { en: "System language", pl: "Język systemu" },
      options: [
        { label: "English", value: "en" },
        { label: "Polski", value: "pl" },
      ],
      defaultValue: "en",
    },
    {
      key: "general.interfaceScale",
      label: { en: "Interface Scale", pl: "Skala interfejsu" },
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
} satisfies SettingsCategory;

export const generalPanel: BuiltinPanelModule = {
  kind: "generated",
  category: generalSettingsCategory,
};
