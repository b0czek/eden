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
      value: {
        type: "object",
        required: true,
        properties: { definition: { type: "object", required: true } },
        additionalProperties: false,
      },
      handler: async ({ daemonManager }, invocation) =>
        daemonManager.updateDefinition(
          (invocation.value as unknown as { definition: DaemonDefinition })
            .definition,
        ),
    },
    enable: {
      params: daemonActionSchema,
      handler: async ({ daemonManager }, invocation) =>
        daemonManager.setEnabled(
          (invocation.params as { appId: string }).appId,
          true,
        ),
    },
    disable: {
      params: daemonActionSchema,
      handler: async ({ daemonManager }, invocation) =>
        daemonManager.setEnabled(
          (invocation.params as { appId: string }).appId,
          false,
        ),
    },
    start: {
      params: daemonActionSchema,
      handler: async ({ daemonManager }, invocation) =>
        daemonManager.start((invocation.params as { appId: string }).appId),
    },
    stop: {
      params: daemonActionSchema,
      handler: async ({ daemonManager }, invocation) =>
        daemonManager.stop((invocation.params as { appId: string }).appId),
    },
    restart: {
      params: daemonActionSchema,
      handler: async ({ daemonManager }, invocation) =>
        daemonManager.restart((invocation.params as { appId: string }).appId),
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
