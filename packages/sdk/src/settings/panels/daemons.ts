import type {
  DaemonDefinition,
  SettingsCategory,
  SettingsPanelActionInputSchema,
  SettingsPanelValue,
} from "@edenapp/types";
import * as Effect from "effect/Effect";
import * as v from "valibot";
import { authorizeDaemonDefinition } from "../../daemon/authorization";
import { daemonDefinitionSchema } from "../../daemon/schemas";
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
      handler: ({ daemonManager, userManager }, invocation, context) =>
        Effect.gen(function* () {
          const definition = yield* Effect.try(() =>
            v.parse(
              daemonDefinitionSchema,
              (invocation.value as unknown as { definition: DaemonDefinition })
                .definition,
            ),
          );
          yield* authorizeDaemonDefinition(
            definition,
            context.user.role === "vendor",
            userManager,
          );
          yield* daemonManager.updateDefinition(definition);
        }),
    },
    enable: {
      params: daemonActionSchema,
      handler: ({ daemonManager }, invocation) =>
        daemonManager.setEnabled(
          (invocation.params as { appId: string }).appId,
          true,
        ),
    },
    disable: {
      params: daemonActionSchema,
      handler: ({ daemonManager }, invocation) =>
        daemonManager.setEnabled(
          (invocation.params as { appId: string }).appId,
          false,
        ),
    },
    start: {
      params: daemonActionSchema,
      handler: ({ daemonManager }, invocation) =>
        daemonManager.start((invocation.params as { appId: string }).appId),
    },
    stop: {
      params: daemonActionSchema,
      handler: ({ daemonManager }, invocation) =>
        daemonManager.stop((invocation.params as { appId: string }).appId),
    },
    restart: {
      params: daemonActionSchema,
      handler: ({ daemonManager }, invocation) =>
        daemonManager.restart((invocation.params as { appId: string }).appId),
    },
  },
  createLoader:
    ({ daemonManager, userManager }) =>
    () =>
      Effect.gen(function* () {
        return {
          data: cloneRendererValue({
            statuses: yield* daemonManager.list(),
            users: yield* userManager.listUsers(),
          }) as unknown as SettingsPanelValue,
        };
      }),
};
