import type { FilesystemLocation } from "@edenapp/types";
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
