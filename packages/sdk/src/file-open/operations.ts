import type { FilesystemLocation } from "@edenapp/types";
import type { FileOpenOperationBoundary } from "./ports";
import type { FileOpen } from "./service";

/** Prepare synchronously; interpret Effects only when retained work starts. */
export function createFileOpenOperations(
  fileOpen: FileOpen,
  boundary: FileOpenOperationBoundary,
) {
  return {
    prepareOpen(location: FilesystemLocation, appId?: string) {
      return boundary.prepareVolumeOperation(
        [location.volume],
        async (reporter) => {
          reporter.update("opening");
          return boundary.run(
            appId === undefined
              ? fileOpen.openFile(location)
              : fileOpen.openFileWith(location, appId),
          );
        },
      );
    },
  };
}

export type FileOpenOperations = ReturnType<typeof createFileOpenOperations>;
