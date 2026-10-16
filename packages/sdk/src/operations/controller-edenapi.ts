import * as v from "valibot";
import { command, defineController } from "../controllers/controller";
import { routedEvent } from "../controllers/events";
import { operationHandleSchema } from "./schemas";
import type { Operations } from "./service";

export function createOperationController(operations: Operations) {
  const input = v.object({ handle: operationHandleSchema });
  return defineController("operation", {
    commands: {
      get: command({ input, handle: ({ handle }) => operations.get(handle) }),
      cancel: command({
        input,
        handle: ({ handle }) => operations.cancel(handle),
      }),
      list: command({ handle: () => operations.list() }),
    },
    events: { changed: routedEvent(operations.changed) },
  });
}
