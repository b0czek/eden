import type {
  ContextMenuItem,
  ContextMenuOpenArgs,
  ContextMenuResult,
} from "@edenapp/types";
import * as v from "valibot";
import { command, defineController } from "../../core/controllers/controller";
import { targetedEvent } from "../../core/controllers/events";
import type { ContextMenu } from "./service";

const openInput: v.GenericSchema<ContextMenuOpenArgs> = v.object({
  title: v.optional(v.string()),
  position: v.object({
    left: v.optional(v.number()),
    right: v.optional(v.number()),
    top: v.optional(v.number()),
    bottom: v.optional(v.number()),
  }),
  items: v.custom<ContextMenuItem[]>(Array.isArray),
});
const resultInput: v.GenericSchema<ContextMenuResult> = v.object({
  requestId: v.string(),
  itemId: v.optional(v.string()),
  reason: v.picklist(["select", "dismiss", "replaced", "close"]),
});

export function createContextMenuController(menu: ContextMenu) {
  return defineController("context-menu", {
    commands: {
      "register-display": command({
        permission: "display",
        handle: (_args, caller) => menu.registerDisplayProvider(caller),
      }),
      open: command({
        input: openInput,
        handle: (args, caller) => menu.openMenu(args, caller),
      }),
      resolve: command({
        permission: "display",
        input: resultInput,
        handle: (result) => menu.resolveMenu(result),
      }),
      close: command({
        input: v.object({ requestId: v.optional(v.string()) }),
        handle: ({ requestId }, caller) => menu.closeMenu(requestId, caller),
      }),
    },
    events: {
      opened: targetedEvent(menu.opened),
      closed: targetedEvent(menu.closed),
    },
  });
}
