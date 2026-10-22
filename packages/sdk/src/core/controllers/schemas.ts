import * as v from "valibot";

export const keyArgsSchema = v.object({ key: v.string() });
export const namespaceArgsSchema = v.object({ appId: v.string() });
export const namespacedKeyArgsSchema = v.object({
  appId: namespaceArgsSchema.entries.appId,
  key: keyArgsSchema.entries.key,
});
