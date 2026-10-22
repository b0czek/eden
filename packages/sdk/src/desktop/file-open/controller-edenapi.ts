import type { FileOpenResult } from "@edenapp/types";
import * as Effect from "effect/Effect";
import * as v from "valibot";
import { command, defineController } from "../../core/controllers/controller";
import { targetedEvent } from "../../core/controllers/events";
import { asError } from "../../core/effects/io";
import type { OperationTask } from "../../core/operations/task";
import {
  filesystemLocationArgsSchema,
  filesystemLocationSchema,
} from "../../platform/filesystem/location-schema";
import type { FileOpenOperations } from "./operations";
import type { FileOpen } from "./service";

const handlerArgs = v.object({
  location: filesystemLocationSchema,
  appId: v.pipe(v.string(), v.nonEmpty()),
});

export function createFileOpenController(
  fileOpen: FileOpen,
  operations: FileOpenOperations,
) {
  function publicOpen<E>(
    task: OperationTask<{ appId: string }, E>,
  ): OperationTask<FileOpenResult, E> {
    return {
      ...task,
      run: (reporter) =>
        task
          .run(reporter)
          .pipe(
            Effect.map(
              ({ appId }): FileOpenResult => ({ success: true, appId }),
            ),
          ),
      encodeFailure: (error) => ({
        success: false,
        error: asError(error).message,
      }),
    };
  }

  return defineController("file", {
    commands: {
      /** Open a file with its default handler */
      open: command({
        mode: "operation",
        input: filesystemLocationArgsSchema,
        handle: ({ location }) => publicOpen(operations.prepareOpen(location)),
      }),
      /** Open a file with a specific app */
      "open-with": command({
        mode: "operation",
        input: handlerArgs,
        handle: ({ location, appId }) =>
          publicOpen(operations.prepareOpen(location, appId)),
      }),
      /** Get the default handler app for a file path */
      "get-handler": command({
        input: filesystemLocationArgsSchema,
        handle: ({ location }) =>
          Effect.map(fileOpen.getHandlerForPath(location), (appId) => ({
            appId,
          })),
      }),
      /** Set user preference for a file path's default handler */
      "set-default-handler": command({
        input: handlerArgs,
        handle: ({ location, appId }) =>
          fileOpen.setDefaultHandler(location, appId),
      }),
      /** Remove user preference for a file path (revert to default) */
      "remove-default-handler": command({
        input: filesystemLocationArgsSchema,
        handle: ({ location }) => fileOpen.removeDefaultHandler(location),
      }),
      /** Get all apps that can handle a specific file path */
      "get-supported-handlers": command({
        input: filesystemLocationArgsSchema,
        handle: ({ location }) => fileOpen.getSupportedHandlers(location),
      }),
      /** Get all file type associations */
      "get-associations": command({
        handle: () => fileOpen.getAllAssociations(),
      }),
    },
    events: { opened: targetedEvent(fileOpen.opened) },
  });
}
