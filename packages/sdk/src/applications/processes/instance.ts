import { randomUUID } from "node:crypto";
import type {
  AppInstance,
  AppManifest,
  FilesystemLocation,
} from "@edenapp/types";
import * as Effect from "effect/Effect";
import type { RuntimeContexts } from "../../core/execution/runtime-contexts";
import type { Views } from "../../desktop/views/service";
import type { AppChannels } from "../appbus/service";
import type { Backends } from "./backends";
import { ProcessStopFailed } from "./errors";

import type { AppRuntime } from "./types";

/** One scope owns a launch's identity, appbus services, backend, and view. */
export const acquireAppInstance = Effect.fn(function* (
  {
    appId,
    manifest,
    installPath,
    runtime,
    bounds,
    launchArgs,
    launchFile,
  }: {
    appId: string;
    manifest: AppManifest;
    installPath: string;
    runtime: AppRuntime;
    bounds?: { x: number; y: number; width: number; height: number };
    launchArgs?: string[];
    launchFile?: FilesystemLocation;
  },
  {
    backends,
    views,
    contexts,
    channels,
  }: {
    backends: Backends;
    views: Views;
    contexts: RuntimeContexts;
    channels: Pick<AppChannels, "unregisterAllServices">;
  },
) {
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      contexts.register(appId, runtime);
      return runtime;
    }),
    (identity) =>
      Effect.sync(() => {
        if (contexts.get(appId) === identity) contexts.unregister(appId);
      }),
  );
  const withdrawServices = Effect.sync(() =>
    channels.unregisterAllServices(appId),
  );
  // Failed startup still needs cleanup before releasing the execution identity.
  yield* Effect.addFinalizer(() => withdrawServices);
  const backend = manifest.backend?.entry
    ? (yield* backends.createBackend(
        appId,
        manifest,
        installPath,
        launchArgs,
        launchFile,
      )).backend
    : undefined;
  let viewId = -1;
  let closed = false;
  const close: Effect.Effect<void, ProcessStopFailed> = Effect.uninterruptible(
    Effect.suspend(() => {
      if (closed) return Effect.void;
      closed = true;
      return withdrawServices.pipe(
        Effect.onExit(() =>
          Effect.suspend(() =>
            viewId !== -1 && views.getViewInfo(viewId)
              ? views.removeView(viewId)
              : Effect.void,
          ),
        ),
        Effect.onExit(() =>
          backend ? backends.terminateBackend(appId, backend) : Effect.void,
        ),
        Effect.mapError(
          (cause) =>
            new ProcessStopFailed({
              appId,
              cause,
              message: `Failed to stop app ${appId}`,
            }),
        ),
      );
    }),
  );
  yield* Effect.addFinalizer(() => close.pipe(Effect.orDie));
  if (manifest.frontend?.entry) {
    yield* Effect.uninterruptible(
      Effect.gen(function* () {
        viewId = yield* views.createView(
          appId,
          manifest,
          installPath,
          bounds,
          launchArgs,
          launchFile,
        );
      }),
    );
  }
  const instance: AppInstance = {
    manifest,
    instanceId: randomUUID(),
    owner: runtime.owner,
    principal: runtime.principal,
    installPath,
    viewId,
    state: "running",
    installedAt: new Date(),
    lastLaunched: new Date(),
  };
  return { instance, backend, close };
});
