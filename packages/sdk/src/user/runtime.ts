import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ExecutionContext } from "../execution/context";
import { Permissions } from "../ipc/permissions";
import { IpcTransport } from "../ipc/transport";
import { RuntimeEnvironment } from "../runtime/environment";
import { normalizeAppIds } from "../utils/normalize";
import { createUserController } from "./controller-edenapi";
import { GrantCatalog } from "./grant-catalog";
import { Users, UsersRestrictedApps } from "./service";

export const registerUsersApi = Effect.gen(function* () {
  (yield* Permissions).registerEventPermission(
    "user/grant-options-changed",
    "user/manage",
  );
  (yield* IpcTransport).registerController(
    createUserController({
      users: yield* Users,
      execution: yield* ExecutionContext,
      grants: yield* GrantCatalog,
    }),
  );
});
export const UsersPortsLive = Layer.effectContext(
  Effect.gen(function* () {
    const { config } = yield* RuntimeEnvironment;

    return Context.make(
      UsersRestrictedApps,
      normalizeAppIds(config.restrictedApps),
    );
  }),
);
