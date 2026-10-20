import type { DaemonDefinition } from "@edenapp/types";
import * as Effect from "effect/Effect";

import type { Users } from "../user/service";
import { DaemonVendorPrincipalError } from "./errors";

/** User-facing boundaries may assign vendor identities only for vendor actors. */
export const authorizeDaemonDefinition = Effect.fn(function* (
  definition: DaemonDefinition,
  actorIsVendor: boolean,
  users: Pick<Users, "getUser">,
) {
  if (actorIsVendor || !definition.runAs) return;
  const principal = yield* users.getUser(definition.runAs.username);
  if (principal?.role === "vendor") {
    return yield* Effect.fail(
      new DaemonVendorPrincipalError({
        appId: definition.appId,
        username: definition.runAs.username,
      }),
    );
  }
});
