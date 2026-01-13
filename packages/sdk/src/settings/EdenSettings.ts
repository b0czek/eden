import { SettingsCategory } from "@edenapp/types";

/**
 * Eden System Settings Schema
 *
 * Defines the settings categories and individual settings for Eden itself.
 */
export const EDEN_SETTINGS_SCHEMA: SettingsCategory[] = [

    {
        id: "general",
        name: "General",
        icon: "settings",
        settings: [
            {
                key: "general.locale",
                label: "Language",
                type: "select",
                description: "System language",
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
        name: "Appearance",
        icon: "image",
        settings: [
            {
                key: "appearance.wallpaper",
                label: "Wallpaper",
                type: "text",
                description: "Background wallpaper CSS value",
                defaultValue: '{"type":"preset","id":"eden-default"}',
            },
        ],
    },
];
