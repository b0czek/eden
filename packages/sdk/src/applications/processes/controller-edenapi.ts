import * as Effect from "effect/Effect";
import * as v from "valibot";
import {
  command,
  defineController,
  operation,
} from "../../core/controllers/controller";
import { viewBoundsSchema } from "../../desktop/views/schemas";
import type { Processes } from "./service";

const appIdSchema = v.object({ appId: v.pipe(v.string(), v.nonEmpty()) });

export function createProcessController(processes: Processes) {
  return defineController("process", {
    commands: {
      launch: operation({
        permission: "manage",
        input: v.object({
          appId: appIdSchema.entries.appId,
          bounds: v.optional(viewBoundsSchema),
        }),
        prepare: ({ appId, bounds }) => {
          processes.assertCanLaunch(appId);
          return (reporter) =>
            Effect.gen(function* () {
              reporter.update("launching");
              return yield* processes.launchApp(appId, bounds);
            });
        },
      }),
      stop: operation({
        permission: "manage",
        input: appIdSchema,
        prepare:
          ({ appId }, caller) =>
          (reporter) =>
            Effect.gen(function* () {
              reporter.update("stopping");
              yield* processes.stopApp(appId, caller);
              return { success: true };
            }),
      }),
      exit: operation({
        prepare: (_, caller) => {
          if (!caller.appId)
            throw new Error("process/exit requires caller app context");
          const exit = processes.prepareExit(caller.appId);
          return (reporter) =>
            Effect.gen(function* () {
              reporter.update("stopping");
              yield* exit;
              return { success: true };
            });
        },
      }),
      list: command({
        permission: "read",
        input: v.object({ showHidden: v.optional(v.boolean()) }),
        handle: ({ showHidden }) => processes.getRunningApps(showHidden),
      }),
      metrics: command({
        permission: "read",
        input: v.object({
          showHidden: v.optional(v.boolean()),
          pollingTimeoutMs: v.optional(v.number()),
          waitForAccurateCpu: v.optional(v.boolean()),
        }),
        handle: ({ showHidden, pollingTimeoutMs, waitForAccurateCpu }) =>
          processes.getMetrics(
            showHidden,
            pollingTimeoutMs,
            waitForAccurateCpu,
          ),
      }),
    },
    events: {
      launched: processes.launched,
      stopped: processes.stopped,
      reloading: processes.reloading,
      error: processes.error,
      exited: processes.exited,
    },
  });
}
