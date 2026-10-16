import type { DaemonDefinition, UserProfile } from "@edenapp/types";
import * as Effect from "effect/Effect";

interface DaemonPrincipalUsers {
  getUser(
    username: string,
  ): Effect.Effect<Pick<UserProfile, "role"> | null, Error>;
}

/** User-facing boundaries may assign vendor identities only for vendor actors. */
export const authorizeDaemonDefinition = Effect.fn(function* (
  definition: DaemonDefinition,
  actorIsVendor: boolean,
  users: DaemonPrincipalUsers,
) {
  if (actorIsVendor || !definition.runAs) return;
  const principal = yield* users.getUser(definition.runAs.username);
  if (principal?.role === "vendor") {
    return yield* Effect.fail(
      new Error("Only a vendor can assign a vendor daemon principal"),
    );
  }
});
