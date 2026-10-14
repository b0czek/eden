import type { SettingsPanelDefinition, UserProfile } from "@edenapp/types";

export const panelUser = (
  grants: string[],
  overrides: Partial<UserProfile> = {},
): UserProfile => ({
  username: "alice",
  name: "Alice",
  role: "standard",
  grants,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

export const panelDefinition = (
  overrides: Partial<SettingsPanelDefinition> = {},
): SettingsPanelDefinition => ({
  id: "vendor.network",
  title: { en: "Network" },
  grant: "panels/network",
  actions: [
    {
      id: "toggle",
      value: { type: "boolean", required: true },
    },
  ],
  ...overrides,
});
