import type { DaemonDefinition } from "@edenapp/types";
import * as v from "valibot";

export const daemonAppIdSchema = v.pipe(v.string(), v.nonEmpty());
export const daemonDefinitionSchema: v.GenericSchema<DaemonDefinition> =
  v.object({
    appId: daemonAppIdSchema,
    enabled: v.boolean(),
    runAs: v.nullable(
      v.object({
        kind: v.literal("user"),
        username: v.pipe(
          v.string(),
          v.check(
            (value) => value.trim().length > 0,
            "runAs username is required",
          ),
        ),
      }),
    ),
    restart: v.picklist(["never", "on-failure", "always"]),
  });
