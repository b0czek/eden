import { randomUUID } from "node:crypto";
import type {
  AppInstance,
  AppManifest,
  ExecutionPrincipal,
  FilesystemLocation,
  ProcessOwner,
  UserProfile,
} from "@edenapp/types";
import * as Effect from "effect/Effect";
import type { AppChannelLifecycle } from "../appbus/ports";
import { asError } from "../effects/io";
import type { RuntimeContexts } from "../execution/runtime-contexts";
import type { Views } from "../views/service";
import type { Backends } from "./backends";

export interface AppRuntime {
  owner: ProcessOwner;
  principal: ExecutionPrincipal;
  profile?: UserProfile;
}

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
    channels: AppChannelLifecycle;
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
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => channels.unregisterAllServices(appId)),
  );
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
        Effect.try({
          try: () =>
            views.createView(
              appId,
              manifest,
              installPath,
              bounds,
              launchArgs,
              launchFile,
            ),
          catch: asError,
        }),
        (id) =>
          Effect.sync(() => {
            const view = views.getViewInfo(id)?.view;
            if (!view) return;
            try {
              views.removeView(id);
            } finally {
              // Native ownership survives failures in view bookkeeping or layout cleanup.
              if (!view.webContents.isDestroyed()) view.webContents.close();
            }
          }),
      )
    : -1;
  if (backend && backends.getBackend(appId) !== backend)
    return yield* Effect.fail(
      new Error(`Backend ${appId} exited during startup`),
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
