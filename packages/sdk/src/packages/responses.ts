import type { PackageInfo } from "@edenapp/types";
import * as Effect from "effect/Effect";
import type { PackageInspection } from "./types";

/** Encode expected inspection failures only at the public API boundary. */
export function packageInfoResponse<E extends { message: string }>(
  inspection: Effect.Effect<PackageInspection, E>,
): Effect.Effect<PackageInfo> {
  return Effect.match(inspection, {
    onSuccess: (info): PackageInfo => ({ success: true, ...info }),
    onFailure: (error): PackageInfo => ({
      success: false,
      error: error.message,
    }),
  });
}
