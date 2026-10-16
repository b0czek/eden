import type { FilesystemLocation } from "@edenapp/types";
import type { FileOpenOperationBoundary } from "./ports";
import type { FileOpen } from "./service";

/** Prepare volume admission synchronously; the operation runtime owns execution. */
export function createFileOpenOperations(
  fileOpen: FileOpen,
  boundary: FileOpenOperationBoundary,
) {
  return {
    prepareOpen(location: FilesystemLocation, appId?: string) {
      return boundary.prepareVolumeOperation([location.volume], (reporter) => {
        reporter.update("opening");
        return appId === undefined
          ? fileOpen.openFile(location)
          : fileOpen.openFileWith(location, appId);
      });
    },
  };
}

export type FileOpenOperations = ReturnType<typeof createFileOpenOperations>;
