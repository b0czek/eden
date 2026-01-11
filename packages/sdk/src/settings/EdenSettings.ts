import { SettingsCategory } from "@edenapp/types";

/**
 * Eden System Settings Schema
 *
 * Defines the settings categories and individual settings for Eden itself.
 */
export const EDEN_SETTINGS_SCHEMA: SettingsCategory[] = [

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
