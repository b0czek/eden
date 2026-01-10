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
    icon: "palette",
    settings: [
      {
        key: "theme",
        label: "Theme",
        description: "Choose the color theme for Eden",
        type: "select",
        defaultValue: "dark",
        options: [
          { value: "dark", label: "Dark" },
          { value: "light", label: "Light" },
          { value: "system", label: "System" },
        ],
      },
      {
        key: "glassMorphism",
        label: "Glass Effects",
        description: "Enable frosted glass visual effects",
        type: "toggle",
        defaultValue: "true",
      },
      {
        key: "animations",
        label: "Animations",
        description: "Enable UI animations and transitions",
        type: "checkbox",
        defaultValue: "true",
      },
      {
        key: "blurStrength",
        label: "Blur Strength",
        description: "Intensity of the glass blur effect",
        type: "range",
        defaultValue: "50",
        min: 0,
        max: 100,
        step: 10,
      },
      {
        key: "fontSize",
        label: "Font Size",
        description: "Base font size in pixels",
        type: "number",
        defaultValue: "14",
        min: 10,
        max: 24,
        step: 1,
      },
      {
        key: "windowStyle",
        label: "Window Style",
        description: "Choose how app windows appear",
        type: "radio",
        defaultValue: "rounded",
        options: [
          { value: "rounded", label: "Rounded corners" },
          { value: "square", label: "Square corners" },
          { value: "pill", label: "Pill shape" },
        ],
      },
    ],
  },
  {
    id: "behavior",
    name: "Behavior",
    icon: "settings",
    settings: [
      {
        key: "confirmClose",
        label: "Confirm before closing apps",
        description:
          "Show confirmation dialog when closing apps with unsaved changes",
        type: "toggle",
        defaultValue: "true",
      },
      {
        key: "restoreSession",
        label: "Restore previous session",
        description: "Automatically restore open apps on startup",
        type: "toggle",
        defaultValue: "false",
      },
      {
        key: "defaultApp",
        label: "Default App",
        description: "App to open on startup",
        type: "text",
        defaultValue: "",
        placeholder: "e.g. com.eden.files",
      },
      {
        key: "notes",
        label: "Startup Notes",
        description: "Notes to display on startup",
        type: "textarea",
        defaultValue: "",
        placeholder: "Enter your notes here...",
      },
    ],
  },
  {
    id: "developer",
    name: "Developer",
    icon: "code",
    settings: [
      {
        key: "hotReload",
        label: "Hot Reload",
        description: "Enable automatic reload of apps during development",
        type: "toggle",
        defaultValue: "true",
      },
      {
        key: "devTools",
        label: "Developer Tools",
        description: "Show developer tools option in app context menu",
        type: "toggle",
        defaultValue: "false",
      },
      {
        key: "logLevel",
        label: "Log Level",
        description: "Amount of detail in console logs",
        type: "select",
        defaultValue: "info",
        options: [
          { value: "error", label: "Error only" },
          { value: "warn", label: "Warnings" },
          { value: "info", label: "Info" },
          { value: "debug", label: "Debug" },
          { value: "verbose", label: "Verbose" },
        ],
      },
    ],
  },
];
