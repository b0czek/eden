import type {
  DaemonDefinition,
  SettingsCategory,
  SettingsPanelActionInputSchema,
  SettingsPanelValue,
} from "@edenapp/types";
import { cloneRendererValue } from "../SettingsPanelCodec";
import type { BuiltinPanelModule } from "./types";

export const daemonsSettingsCategory = {
  id: "daemons",
  name: { en: "Daemons", pl: "Demony" },
  description: {
    en: "Configure backend services that run independently of user sessions.",
    pl: "Konfiguruj usługi backendowe działające niezależnie od sesji użytkowników.",
  },
  icon: "cpu",
  view: "daemons" as const,
  grant: "preset/daemon/manage",
  grantScope: "global",
  settings: [],
} satisfies SettingsCategory;

const daemonActionSchema: SettingsPanelActionInputSchema = {
  type: "object",
  required: true,
  properties: { appId: { type: "string", required: true } },
  additionalProperties: false,
};

export const daemonsPanel: BuiltinPanelModule = {
  kind: "custom",
  category: daemonsSettingsCategory,
  actions: {
    "update-definition": {
      input: {
        type: "object",
        required: true,
        properties: { definition: { type: "object", required: true } },
        additionalProperties: false,
      },
      handler: async ({ daemonManager }, input) =>
        daemonManager.updateDefinition(
          (input as unknown as { definition: DaemonDefinition }).definition,
        ),
    },
    enable: {
      input: daemonActionSchema,
      handler: async ({ daemonManager }, input) =>
        daemonManager.setEnabled(
          (input as unknown as { appId: string }).appId,
          true,
        ),
    },
    disable: {
      input: daemonActionSchema,
      handler: async ({ daemonManager }, input) =>
        daemonManager.setEnabled(
          (input as unknown as { appId: string }).appId,
          false,
        ),
    },
    start: {
      input: daemonActionSchema,
      handler: async ({ daemonManager }, input) =>
        daemonManager.start((input as unknown as { appId: string }).appId),
    },
    stop: {
      input: daemonActionSchema,
      handler: async ({ daemonManager }, input) =>
        daemonManager.stop((input as unknown as { appId: string }).appId),
    },
    restart: {
      input: daemonActionSchema,
      handler: async ({ daemonManager }, input) =>
        daemonManager.restart((input as unknown as { appId: string }).appId),
    },
  },
  createLoader:
    ({ daemonManager, userManager }) =>
    async () => ({
      data: cloneRendererValue({
        statuses: await daemonManager.list(),
        users: await userManager.listUsers(),
      }) as unknown as SettingsPanelValue,
    }),
};
