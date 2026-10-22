import * as path from "node:path";
import * as v from "valibot";
import type { EdenVolumeOptions } from "../../../api/control-plane";

export const volumeIdSchema = v.pipe(v.string(), v.nonEmpty());
export const volumeEjectArgsSchema = v.object({ volume: volumeIdSchema });

export const volumeRegistrationSchema = v.object({
  id: v.pipe(
    volumeIdSchema,
    v.check(
      (id) => !!id.trim() && id !== "home",
      "Volume ID must be nonempty and cannot be 'home'",
    ),
  ),
  label: v.pipe(
    v.string(),
    v.check((label) => !!label.trim(), "Volume label is required"),
  ),
  kind: v.picklist(["local", "removable", "network"]),
  rootPath: v.pipe(
    v.string(),
    v.check(
      path.isAbsolute,
      "Volume root must be an absolute path to an existing directory",
    ),
  ),
  readOnly: v.optional(v.boolean()),
  supportsWatch: v.optional(v.boolean()),
});

// Host options can own callback state; only copy their declared data fields.
export const volumeOptionsSchema = v.optional(
  v.pipe(
    v.object({
      ejectGroup: v.optional(
        v.pipe(
          v.string(),
          v.check(
            (key) => !!key.trim(),
            "An eject group requires a nonempty key and an eject operation",
          ),
        ),
      ),
      eject: v.optional(
        v.custom<NonNullable<EdenVolumeOptions["eject"]>>(
          (value) => typeof value === "function",
        ),
      ),
    }),
    v.check(
      (options) =>
        options.ejectGroup === undefined || options.eject !== undefined,
      "An eject group requires a nonempty key and an eject operation",
    ),
  ),
  {},
);
