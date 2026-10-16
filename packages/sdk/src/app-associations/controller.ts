import type { AppAssociation } from "@edenapp/types";
import * as Effect from "effect/Effect";
import * as v from "valibot";
import { command, defineController } from "../controllers/controller";
import type { AppAssociations } from "./service";

export function createAppAssociationsController(associations: AppAssociations) {
  return defineController("associations", {
    commands: {
      get: command({
        input: v.object({ key: v.string() }),
        handle: ({ key }): { association: AppAssociation | undefined } => ({
          association: associations.get(key),
        }),
      }),
      set: command({
        input: v.object({
          key: v.string(),
          appId: v.string(),
          kind: v.string(),
          label: v.optional(v.string()),
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
        input: v.object({ key: v.string() }),
        handle: ({ key }) =>
          Effect.map(associations.remove(key), (): { success: boolean } => ({
            success: true,
          })),
      }),
      list: command({
        input: v.object({ kindPrefix: v.optional(v.string()) }),
        handle: (
          options,
        ): { associations: Record<string, AppAssociation> } => ({
          associations: associations.list(options),
        }),
      }),
    },
  });
}
