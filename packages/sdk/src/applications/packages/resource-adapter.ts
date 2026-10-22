import * as Effect from "effect/Effect";
import * as FiberSet from "effect/FiberSet";
import type { ResourceProtocolPort } from "../../platform/ports/types";
import type { DlcResourceProtocols } from "./dlc-resources";

/** Own resource requests at the platform's Promise callback boundary. */
// @eden-effect-next-line unresolved-requirements -- Protocol registration acquires request fibers in the caller-owned DLC scope.
export function createDlcResourceProtocols(
  protocols: ResourceProtocolPort,
): DlcResourceProtocols {
  return {
    serve: (scheme, authorize, handler) =>
      Effect.gen(function* () {
        const run = yield* FiberSet.makeRuntimePromise();
        yield* Effect.acquireRelease(
          Effect.try(() =>
            protocols.handle(scheme, authorize, (request) =>
              run(handler(request)),
            ),
          ),
          () => Effect.sync(() => protocols.unhandle(scheme)),
        );
      }),
  };
}
