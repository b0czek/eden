import type { AppAssociation } from "@edenapp/types";
import * as Effect from "effect/Effect";
import * as v from "valibot";
import { command, defineController } from "../controllers/controller";
import { keyArgsSchema } from "../controllers/schemas";
import {
  appAssociationSchema,
  associationKeySchema,
  associationListSchema,
} from "./schemas";
import type { AppAssociations } from "./service";

export function createAppAssociationsController(associations: AppAssociations) {
  return defineController("associations", {
    commands: {
      get: command({
        input: keyArgsSchema,
        handle: ({ key }): { association: AppAssociation | undefined } => ({
          association: associations.get(key),
        }),
      }),
      set: command({
        input: v.object({
          key: associationKeySchema,
          appId: appAssociationSchema.entries.appId,
          kind: appAssociationSchema.entries.kind,
          label: appAssociationSchema.entries.label,
        }),
        handle: ({ key, ...association }) =>
          Effect.map(
            associations.set(key, association),
            (): { success: boolean } => ({
              success: true,
            }),
          ),
      }),
      remove: command({
        input: v.object({ key: associationKeySchema }),
        handle: ({ key }) =>
          Effect.map(associations.remove(key), (): { success: boolean } => ({
            success: true,
          })),
      }),
      list: command({
        input: associationListSchema,
        handle: (
          options,
        ): { associations: Record<string, AppAssociation> } => ({
          associations: associations.list(options),
        }),
      }),
    },
  });
}
