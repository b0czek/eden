import * as v from "valibot";
import { command, defineController } from "../controllers/controller";
import { APP_EVENT_NAMES } from "../generated/runtime";
import { operationHandleSchema } from "../operations/schemas";
import type { Operations } from "../operations/service";
import type { Views } from "../views/service";
import type { EventRouting } from "./event-routing";
import { assertFoundationEventAllowed } from "./foundation-policy";

export function createEventController(
  subscriptions: EventRouting,
  views: Views,
  operations: Operations,
) {
  const eventArgs = v.object({
    eventName: v.string(),
    operation: v.optional(
      v.object({
        handle: operationHandleSchema,
        terminalOnly: v.optional(v.boolean()),
      }),
    ),
  });
  const checkObservation = (
    eventName: string,
    operation: v.InferOutput<typeof eventArgs>["operation"],
  ) => {
    if (operation && eventName !== "operation/changed")
      throw new Error("Operation filters require operation/changed");
    return operation;
  };
  return defineController("event", {
    commands: {
      subscribe: command({
        input: eventArgs,
        handle: ({ eventName, operation }, caller) => {
          if (!APP_EVENT_NAMES.includes(eventName))
            throw new Error(`Event '${eventName}' is not supported`);
          checkObservation(eventName, operation);
          if (operation) operations.get(operation.handle);
          if (caller.foundation) {
            assertFoundationEventAllowed(eventName);
            subscriptions.subscribeFoundation(eventName);
          } else if (caller.webContentsId !== undefined) {
            const viewId = views.getViewIdByWebContentsId(caller.webContentsId);
            if (viewId === undefined) throw new Error("View not found");
            subscriptions.subscribe(viewId, eventName, operation);
          } else if (caller.appId)
            subscriptions.subscribeBackend(caller.appId, eventName, operation);
          else throw new Error("Caller identity not found");
        },
      }),
      unsubscribe: command({
        input: eventArgs,
        handle: ({ eventName, operation }, caller) => {
          checkObservation(eventName, operation);
          if (caller.foundation) {
            assertFoundationEventAllowed(eventName);
            subscriptions.unsubscribeFoundation(eventName);
          } else if (caller.webContentsId !== undefined) {
            const viewId = views.getViewIdByWebContentsId(caller.webContentsId);
            if (viewId !== undefined)
              subscriptions.unsubscribe(viewId, eventName, operation);
          } else if (caller.appId)
            subscriptions.unsubscribeBackend(
              caller.appId,
              eventName,
              operation,
            );
        },
      }),
      exists: command({
        input: v.object({ eventName: v.string() }),
        handle: ({ eventName }) => APP_EVENT_NAMES.includes(eventName),
      }),
    },
  });
}
