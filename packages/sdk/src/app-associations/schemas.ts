import * as v from "valibot";

const nonblank = v.pipe(
  v.string(),
  v.check((value) => !!value.trim()),
);

export const associationKeySchema = v.pipe(
  v.string(),
  v.check((key) => !!key.trim(), "Association key is required"),
);
export const appAssociationSchema = v.object({
  appId: nonblank,
  kind: nonblank,
  label: v.optional(v.string()),
});
export const associationListSchema = v.object({
  kindPrefix: v.optional(v.string()),
});
