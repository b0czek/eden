import type {
  DaemonDefinition,
  SettingsCategory,
  SettingsPanelActionInputSchema,
  SettingsPanelValue,
} from "@edenapp/types";
import * as Effect from "effect/Effect";
import * as v from "valibot";
import { authorizeDaemonDefinition } from "../../../daemon/authorization";
import { daemonDefinitionSchema } from "../../../daemon/schemas";
import { cloneRendererValue } from "../serialization";
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
      handler: ({ daemons, users }, invocation, context) =>
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
            users,
          );
          yield* daemons.updateDefinition(definition);
        }),
    },
    enable: {
      params: daemonActionSchema,
      handler: ({ daemons }, invocation) =>
        daemons.setEnabled(
          (invocation.params as { appId: string }).appId,
          true,
        ),
    },
    disable: {
      params: daemonActionSchema,
      handler: ({ daemons }, invocation) =>
        daemons.setEnabled(
          (invocation.params as { appId: string }).appId,
          false,
        ),
    },
    start: {
      params: daemonActionSchema,
      handler: ({ daemons }, invocation) =>
        daemons.start((invocation.params as { appId: string }).appId),
    },
    stop: {
      params: daemonActionSchema,
      handler: ({ daemons }, invocation) =>
        daemons.stop((invocation.params as { appId: string }).appId),
    },
    restart: {
      params: daemonActionSchema,
      handler: ({ daemons }, invocation) =>
        daemons.restart((invocation.params as { appId: string }).appId),
    },
  },
  createLoader:
    ({ daemons, users }) =>
    () =>
      Effect.gen(function* () {
        return {
          data: cloneRendererValue({
            statuses: yield* daemons.list(),
            users: yield* users.listUsers(),
          }) as unknown as SettingsPanelValue,
        };
      }),
};
