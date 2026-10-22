import * as v from "valibot";
import { passwordSchema, usernameSchema } from "../../core/user/schemas";

export const sessionLoginSchema = v.object({
  username: usernameSchema,
  password: passwordSchema,
});
