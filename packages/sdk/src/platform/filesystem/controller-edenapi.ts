import type { FilesystemOpenMode } from "@edenapp/types";
import * as Effect from "effect/Effect";
import * as v from "valibot";
import { command, defineController } from "../../core/controllers/controller";
import { targetedEvent } from "../../core/controllers/events";
import {
  filesystemHandleSchema,
  filesystemLocationArgsSchema,
  filesystemLocationSchema,
  filesystemSourceArgsSchema,
  filesystemSourceSchema,
} from "./location-schema";
import type { Filesystem } from "./service";

const encoding = v.optional(
  v.picklist([
    "ascii",
    "utf8",
    "utf-8",
    "utf16le",
    "utf-16le",
    "ucs2",
    "ucs-2",
    "base64",
    "base64url",
    "latin1",
    "binary",
    "hex",
  ]),
  "utf-8",
);
const readArgs = v.object({ location: filesystemSourceSchema, encoding });
const openMode = v.picklist([
  "read",
]) satisfies v.GenericSchema<FilesystemOpenMode>;
const openArgs = v.object({
  location: filesystemLocationSchema,
  mode: v.optional(openMode, "read"),
});
const closeArgs = v.object({ handle: filesystemHandleSchema });
const writeArgs = v.object({
  location: filesystemLocationSchema,
  content: v.string(),
  encoding,
});
const writeBinaryArgs = v.object({
  location: filesystemLocationSchema,
  content: v.custom<Uint8Array>(
    (value) => value instanceof Uint8Array,
    "Binary file content must be a Uint8Array",
  ),
});
const watchArgs = v.object({
  location: filesystemLocationSchema,
});
const unwatchArgs = v.object({
  watchId: v.string(),
});
const searchArgs = v.object({
  location: filesystemLocationSchema,
  pattern: v.string(),
  limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0)), 10),
});
const transferArgs = v.object({
  from: filesystemLocationSchema,
  to: filesystemLocationSchema,
  overwrite: v.optional(v.boolean(), false),
});

const trashEntryArgs = v.object({
  id: v.pipe(v.string(), v.uuid()),
});
const trashRestoreArgs = v.object({
  id: v.pipe(v.string(), v.uuid()),
  location: v.optional(filesystemLocationSchema),
});

export function createFilesystemController(files: Filesystem) {
  return defineController("fs", {
    commands: {
      "access-scope": command({
        permission: "read",
        input: v.object({ volume: v.pipe(v.string(), v.nonEmpty()) }),
        handle: ({ volume }) => files.accessScope(volume),
      }),
      open: command({
        permission: "read",
        input: openArgs,
        handle: ({ location, mode }) => files.open(location, mode),
      }),
      close: command({
        permission: "read",
        input: closeArgs,
        handle: ({ handle }) => files.close(handle),
      }),
      read: command({
        permission: "read",
        input: readArgs,
        handle: ({ location, encoding }) => files.readFile(location, encoding),
      }),
      "read-binary": command({
        permission: "read",
        input: filesystemSourceArgsSchema,
        handle: ({ location }) => files.readBinaryFile(location),
      }),
      write: command({
        permission: "write",
        input: writeArgs,
        handle: ({ location, content, encoding }) =>
          files.writeFile(location, content, encoding),
      }),
      "write-binary": command({
        permission: "write",
        input: writeBinaryArgs,
        handle: ({ location, content }) =>
          files.writeBinaryFile(location, content),
      }),
      exists: command({
        permission: "read",
        input: filesystemLocationArgsSchema,
        handle: ({ location }) => files.exists(location),
      }),
      mkdir: command({
        permission: "write",
        input: filesystemLocationArgsSchema,
        handle: ({ location }) => files.mkdir(location),
      }),
      readdir: command({
        permission: "read",
        input: filesystemLocationArgsSchema,
        handle: ({ location }) => files.readdir(location),
      }),
      stat: command({
        permission: "read",
        input: filesystemSourceArgsSchema,
        handle: ({ location }) => files.stat(location),
      }),
      lstat: command({
        permission: "read",
        input: filesystemLocationArgsSchema,
        handle: ({ location }) => files.lstat(location),
      }),
      watch: command({
        permission: "read",
        input: watchArgs,
        handle: ({ location }, caller) =>
          files.watchDirectory(location, caller.webContentsId),
      }),
      unwatch: command({
        permission: "read",
        input: unwatchArgs,
        handle: ({ watchId }, caller) =>
          files.unwatch(watchId, caller.webContentsId),
      }),
      resolve: command({
        permission: "resolve",
        input: filesystemLocationArgsSchema,
        handle: ({ location }) =>
          Effect.map(files.resolvePath(location), (realPath) => ({ realPath })),
      }),
      search: command({
        permission: "read",
        input: searchArgs,
        handle: ({ location, pattern, limit }) =>
          files.search(location, pattern, limit),
      }),
      delete: command({
        permission: "write",
        mode: "operation",
        input: filesystemLocationArgsSchema,
        handle: ({ location }) =>
          files.prepareVolumeOperation([location.volume], (reporter) =>
            files.delete(location, reporter),
          ),
      }),
      cp: command({
        permission: "write",
        mode: "operation",
        input: transferArgs,
        handle: ({ from, to, overwrite }) => ({
          ...files.prepareVolumeOperation(
            [from.volume, to.volume],
            (reporter) => files.copy(from, to, overwrite, reporter),
          ),
          cancellable: true,
        }),
      }),
      mv: command({
        permission: "write",
        mode: "operation",
        input: transferArgs,
        handle: ({ from, to, overwrite }) =>
          files.prepareVolumeOperation([from.volume, to.volume], (reporter) =>
            files.move(from, to, overwrite, reporter),
          ),
      }),
      /** Move a Home item to Trash. */
      trash: command({
        permission: "write",
        mode: "operation",
        input: filesystemLocationArgsSchema,
        handle: ({ location }) =>
          files.prepareVolumeOperation([location.volume], (reporter) =>
            files.moveToTrash(location, reporter),
          ),
      }),
      /** List Trash items from folders the caller can access, newest first. */
      "trash-entries": command({
        permission: "read",
        handle: () => files.trashEntries(),
      }),
      /** Restore a Trash item to its original location or another destination. */
      "trash-restore": command({
        permission: "write",
        mode: "operation",
        input: trashRestoreArgs,
        handle: ({ id, location }) =>
          files.prepareVolumeOperation(
            ["home", location?.volume ?? "home"],
            (reporter) => files.restoreFromTrash(id, location, reporter),
          ),
      }),
      /** Permanently delete one Trash item. */
      "trash-delete": command({
        permission: "write",
        mode: "operation",
        input: trashEntryArgs,
        handle: ({ id }) =>
          files.prepareVolumeOperation(["home"], (reporter) =>
            files.deleteFromTrash(id, reporter),
          ),
      }),
      /** Permanently delete every Trash item visible to the caller. */
      "trash-empty": command({
        permission: "write",
        mode: "operation",
        handle: () =>
          files.prepareVolumeOperation(["home"], (reporter) =>
            files.emptyTrash(reporter),
          ),
      }),
    },
    events: {
      changed: targetedEvent(files.changed),
      "trash-changed": files.trashChanged,
    },
  });
}
