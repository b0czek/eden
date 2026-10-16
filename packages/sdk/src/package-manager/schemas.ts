import * as path from "node:path";
import * as v from "valibot";
export const packageIdSchema = v.pipe(v.string(), v.nonEmpty());

export const packageListOptionsSchema = v.object({
  showHidden: v.optional(v.boolean()),
  showRestricted: v.optional(v.boolean()),
  kind: v.optional(v.picklist(["app", "dlc"])),
  hostAppId: v.optional(packageIdSchema),
});

export const packageInstallOptionsSchema = v.object({
  replace: v.optional(v.boolean()),
});

/** Host paths retain their spelling; filesystem and package checks belong to the service. */
export const packageHostPathSchema = v.pipe(
  v.string(),
  v.nonEmpty(),
  v.check(path.isAbsolute, "Package source path must be absolute"),
  v.check(
    (value) => !value.includes("\0"),
    "Package source path must not contain null bytes",
  ),
);
