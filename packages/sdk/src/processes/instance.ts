import { randomUUID } from "node:crypto";
import type {
  AppInstance,
  AppManifest,
  FilesystemLocation,
} from "@edenapp/types";
import * as Effect from "effect/Effect";
import type { AppChannels } from "../appbus/service";
import type { RuntimeContexts } from "../execution/runtime-contexts";
import type { Views } from "../views/service";
import type { Backends } from "./backends";
import { BackendStartupFailed } from "./errors";

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
  const viewId = manifest.frontend?.entry
    ? yield* Effect.acquireRelease(
        views.createView(
          appId,
          manifest,
          installPath,
          bounds,
          launchArgs,
          launchFile,
        ),
        (id) =>
          Effect.suspend(() =>
            views.getViewInfo(id)
              ? views.removeView(id).pipe(Effect.orDie)
              : Effect.void,
          ),
      )
    : -1;
  // Finalizers run in reverse order: withdraw discovery before native teardown.
  yield* Effect.addFinalizer(() => withdrawServices);
  if (backend && backends.getBackend(appId) !== backend)
    return yield* Effect.fail(
      new BackendStartupFailed({
        appId,
        reason: "exited",
        message: `Backend ${appId} exited during startup`,
      }),
    );
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
  return { instance, backend };
});
