import * as Effect from "effect/Effect";
import type { ResourceProtocolPort } from "../platform/ports";
import type { DlcResourceProtocols } from "./dlc-resources";
/** Interpret resource handlers at the platform's Promise callback boundary. */
export function createDlcResourceProtocols(
  protocols: ResourceProtocolPort,
  run: <A, E>(work: Effect.Effect<A, E>) => Promise<A>,
): DlcResourceProtocols {
  return {
    serve: (scheme, authorize, handler) =>
      Effect.acquireRelease(
        Effect.try(() =>
          protocols.handle(scheme, authorize, (request) =>
            run(handler(request)),
          ),
        ),
        () => Effect.sync(() => protocols.unhandle(scheme)),
      ),
  };
}
