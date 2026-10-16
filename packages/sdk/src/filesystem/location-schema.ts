import type { FilesystemLocation, FilesystemSource } from "@edenapp/types";
import * as v from "valibot";

const invalidLocation = "Filesystem location requires volume and path";

export const filesystemLocationSchema = v.object(
  {
    volume: v.pipe(v.string(invalidLocation), v.nonEmpty(invalidLocation)),
    path: v.string(invalidLocation),
  },
  invalidLocation,
) satisfies v.GenericSchema<FilesystemLocation>;

export const filesystemLocationArgsSchema = v.object({
  location: filesystemLocationSchema,
});

export const filesystemHandleSchema = v.strictObject({
  handleId: v.pipe(v.string(), v.nonEmpty()),
});

export const filesystemSourceSchema = v.pipe(
  v.unknown(),
  v.check(
    (source) =>
      !(
        source !== null &&
        typeof source === "object" &&
        "handleId" in source &&
        ("volume" in source || "path" in source)
      ),
    "Filesystem source must be a location or a handle",
  ),
  v.union(
    [filesystemHandleSchema, filesystemLocationSchema],
    "Filesystem source requires volume and path or a handleId",
  ),
) satisfies v.GenericSchema<unknown, FilesystemSource>;

export const filesystemSourceArgsSchema = v.object({
  location: filesystemSourceSchema,
});
