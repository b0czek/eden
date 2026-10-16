import type { FilePickerOpenArgs, FilePickerResult } from "@edenapp/types";
import * as v from "valibot";
import { command, defineController } from "../controllers/controller";
import { targetedEvent } from "../controllers/events";
import { filesystemLocationSchema } from "../filesystem/FilesystemLocationSchema";
import type { FilePicker } from "./service";

const openInput: v.GenericSchema<FilePickerOpenArgs> = v.object({
  mode: v.picklist(["open", "save"]),
  selection: v.optional(v.picklist(["file", "directory"])),
  multiple: v.optional(v.boolean()),
  title: v.optional(v.string()),
  initialLocation: v.optional(filesystemLocationSchema),
  allowedVolumes: v.optional(v.array(v.string())),
  suggestedName: v.optional(v.string()),
  filters: v.optional(
    v.array(
      v.object({
        name: v.string(),
        extensions: v.optional(v.array(v.string())),
        mimeTypes: v.optional(v.array(v.string())),
      }),
    ),
  ),
  confirmLabel: v.optional(v.string()),
  canCreateDirectories: v.optional(v.boolean()),
  overwritePrompt: v.optional(v.boolean()),
});

const resultInput: v.GenericSchema<FilePickerResult> = v.object({
  requestId: v.string(),
  reason: v.picklist(["select", "cancel", "close"]),
  locations: v.optional(
    v.array(
      filesystemLocationSchema,
      "File picker selection requires a nonempty locations array",
    ),
  ),
});

export function createFilePickerController(picker: FilePicker) {
  return defineController("file-picker", {
    commands: {
      "register-display": command({
        permission: "display",
        handle: (_args, caller) => picker.registerDisplayProvider(caller),
      }),
      open: command({
        input: openInput,
        handle: (args, caller) => picker.openPicker(args, caller),
      }),
      resolve: command({
        permission: "display",
        input: resultInput,
        handle: (args, caller) => picker.resolvePicker(args, caller),
      }),
      close: command({
        input: v.object({ requestId: v.optional(v.string()) }),
        handle: ({ requestId }, caller) =>
          picker.closePicker(requestId, caller),
      }),
    },
    events: {
      opened: targetedEvent(picker.opened),
      closed: targetedEvent(picker.closed),
    },
  });
}
