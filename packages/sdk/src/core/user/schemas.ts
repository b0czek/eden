import * as v from "valibot";

export const usernameSchema = v.string();
export const passwordSchema = v.string();
export const defaultUsernameSchema = v.nullable(usernameSchema);
const roleSchema = v.picklist(["standard", "vendor"]);

export const createUserSchema = v.object({
  username: v.optional(usernameSchema),
  name: v.string(),
  role: v.optional(roleSchema),
  password: passwordSchema,
  grants: v.optional(v.array(v.string())),
  directoryRestriction: v.optional(v.string()),
});

export const updateUserSchema = v.object({
  username: usernameSchema,
  name: v.optional(v.string()),
  role: v.optional(roleSchema),
  grants: v.optional(v.array(v.string())),
  directoryRestriction: v.optional(v.nullable(v.string())),
});

export const setUserPasswordSchema = v.object({
  username: usernameSchema,
  password: passwordSchema,
});
