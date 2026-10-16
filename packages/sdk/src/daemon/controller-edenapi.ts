import * as Effect from "effect/Effect";
import * as v from "valibot";
import {
  command,
  defineController,
  operation,
} from "../controllers/controller";
import type { ExecutionContext } from "../execution/context";
import type { Users } from "../user/service";
import { authorizeDaemonDefinition } from "./authorization";
import { daemonAppIdSchema, daemonDefinitionSchema } from "./schemas";
import type { Daemons } from "./service";

export function createDaemonController(
  daemons: Daemons,
  execution: ExecutionContext,
  users: Users,
) {
  const appArgs = v.object({ appId: daemonAppIdSchema });
  return defineController("daemon", {
    commands: {
      list: command({ permission: "read", handle: () => daemons.list() }),
      "update-definition": command({
        permission: "manage",
        input: v.object({ definition: daemonDefinitionSchema }),
        handle: ({ definition }) =>
          Effect.gen(function* () {
            yield* authorizeDaemonDefinition(
              definition,
              execution.isVendor(),
              users,
            );
            yield* daemons.updateDefinition(definition);
            return { success: true } as const;
          }),
      }),
      enable: command({
        permission: "manage",
        input: appArgs,
        handle: ({ appId }) =>
          Effect.map(
            daemons.setEnabled(appId, true),
            () => ({ success: true }) as const,
          ),
      }),
      disable: command({
        permission: "manage",
        input: appArgs,
        handle: ({ appId }) =>
          Effect.map(
            daemons.setEnabled(appId, false),
            () => ({ success: true }) as const,
          ),
      }),
      start: operation({
        permission: "manage",
        input: appArgs,
        prepare:
          ({ appId }) =>
          (reporter) => {
            reporter.update("starting-daemon");
            return Effect.map(
              daemons.start(appId),
              () => ({ success: true }) as const,
            );
          },
      }),
      stop: operation({
        permission: "manage",
        input: appArgs,
        prepare:
          ({ appId }) =>
          (reporter) => {
            reporter.update("stopping-daemon");
            return Effect.map(
              daemons.stop(appId),
              () => ({ success: true }) as const,
            );
          },
      }),
      restart: operation({
        permission: "manage",
        input: appArgs,
        prepare:
          ({ appId }) =>
          (reporter) => {
            reporter.update("restarting-daemon");
            return Effect.map(
              daemons.restart(appId),
              () => ({ success: true }) as const,
            );
          },
      }),
    },
    events: { changed: daemons.changed },
  });
}
