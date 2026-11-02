import * as v from "valibot";
import { command, defineController } from "../controllers/controller";
import type { Streams } from "./service";

const streamHandleSchema = v.object({
  command: v.string(),
  id: v.string(),
});

export function createStreamController(streams: Streams) {
  return defineController("stream", {
    commands: {
      /**
       * Return credit for chunks that the caller consumed from its stream.
       * Stream readers send this automatically.
       */
      ack: command({
        input: v.object({
          handle: streamHandleSchema,
          count: v.pipe(v.number(), v.integer(), v.minValue(1)),
        }),
        handle: ({ handle, count }, caller) =>
          streams.acknowledge(handle, count, caller),
      }),
      /** Stop a stream that the caller opened. */
      cancel: command({
        input: v.object({ handle: streamHandleSchema }),
        handle: ({ handle }, caller) => streams.cancel(handle, caller),
      }),
    },
  });
}
