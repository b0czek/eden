import * as v from "valibot";
import type { EdenAssociationsApi } from "../api/ControlPlaneApi";
import type { SdkContext } from "../api/sdk-context";
import { keyArgsSchema } from "../controllers/schemas";
import {
  appAssociationSchema,
  associationKeySchema,
  associationListSchema,
} from "./schemas";
import type { AppAssociations } from "./service";

export function createAssociationsSdkController({
  associations,
  sdk,
}: {
  associations: AppAssociations;
  sdk: SdkContext;
}): EdenAssociationsApi {
  return {
    get: (key) =>
      sdk.run(() => {
        const association = associations.get(
          v.parse(keyArgsSchema.entries.key, key),
        );
        return association ? structuredClone(association) : undefined;
      }),
    list: (options) =>
      sdk.run(() =>
        structuredClone(
          associations.list(
            v.parse(v.optional(associationListSchema, {}), options),
          ),
        ),
      ),
    set: async (key, input) => {
      const validKey = v.parse(associationKeySchema, key);
      const association = v.parse(appAssociationSchema, input);
      await sdk.effect(associations.set(validKey, association));
    },
    remove: async (key) =>
      sdk.effect(associations.remove(v.parse(associationKeySchema, key))),
  };
}
