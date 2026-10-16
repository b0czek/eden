import * as v from "valibot";

export const operationHandleSchema = v.object({
  command: v.string(),
  id: v.string(),
});
