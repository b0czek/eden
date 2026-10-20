import * as Effect from "effect/Effect";
import * as v from "valibot";
import { command, defineController } from "../controllers/controller";
import type { CommandCallerContext } from "../execution/context";
import { AppChannelCallerRequired } from "./errors";
import type { AppChannels } from "./service";

function callerAppId(caller: CommandCallerContext) {
  return caller.appId
    ? Effect.succeed(caller.appId)
    : Effect.fail(new AppChannelCallerRequired());
}

export function createAppChannelsController(channels: AppChannels) {
  return defineController("appbus", {
    commands: {
      /**
       * Register a service that this app exposes
       * Requires "appbus/expose" permission
       */
      register: command({
        permission: "expose",
        input: v.object({
          serviceName: v.string(),
          description: v.optional(v.string()),
          allowedClients: v.optional(v.array(v.string())),
        }),
        handle: (
          args,
          caller,
        ): Effect.Effect<{ success: boolean; error?: string }> =>
          Effect.gen(function* () {
            const appId = yield* callerAppId(caller);
            yield* channels.registerService(
              appId,
              args.serviceName,
              caller.webContentsId ?? -1,
              {
                description: args.description,
                allowedClients: args.allowedClients,
              },
            );
            return { success: true };
          }).pipe(
            Effect.catch((error) =>
              Effect.succeed<{ success: boolean; error?: string }>({
                success: false,
                error: error.message,
              }),
            ),
          ),
      }),
      /**
       * Unregister a service
       * Requires "appbus/expose" permission
       */
      unregister: command({
        permission: "expose",
        input: v.object({ serviceName: v.string() }),
        handle: ({ serviceName }, caller) =>
          Effect.flatMap(callerAppId(caller), (appId) =>
            Effect.map(
              channels.unregisterService(appId, serviceName),
              (success) => ({ success }),
            ),
          ),
      }),
      /**
       * List all available services
       * No permission required
       */
      list: command({ handle: () => ({ services: channels.listServices() }) }),
      /**
       * List services by app ID
       * No permission required
       */
      "list-by-app": command({
        input: v.object({ appId: v.string() }),
        handle: ({ appId }) => ({ services: channels.getServicesByApp(appId) }),
      }),
      /**
       * Connect to another app's service
       * Creates MessageChannel and transfers ports directly to both apps
       * Requires "appbus/connect" permission
       */
      connect: command({
        permission: "connect",
        input: v.object({ targetAppId: v.string(), serviceName: v.string() }),
        handle: ({ targetAppId, serviceName }, caller) =>
          Effect.flatMap(callerAppId(caller), (appId) =>
            channels.connect(
              appId,
              caller.webContentsId ?? 0,
              targetAppId,
              serviceName,
            ),
          ),
      }),
    },
  });
}
