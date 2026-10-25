import { randomUUID } from "node:crypto";
import type { AppInstance, AppManifest } from "@edenapp/types";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import type { RuntimeContexts } from "../../core/execution/runtime-contexts";
import type { Views } from "../../desktop/views/service";
import type { Backends } from "./backends";

import type { LaunchRequest } from "./types";

/** Acquire resources in the process-owned instance scope. */
export const acquireAppInstance = Effect.fn(function* (
  {
    appId,
    manifest,
    installPath,
    runtime,
    bounds,
    launchArgs,
    launchFile,
  }: LaunchRequest & {
    manifest: AppManifest;
    installPath: string;
  },
  {
    backends,
    views,
    contexts,
  }: {
    backends: Backends;
    views: Views;
    contexts: RuntimeContexts;
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
        (viewId) =>
          Effect.suspend(() =>
            views.getViewInfo(viewId) ? views.removeView(viewId) : Effect.void,
          ).pipe(Effect.orDie),
      )
    : -1;
  const instance: AppInstance = {
    manifest,
    instanceId: randomUUID(),
    owner: runtime.owner,
    principal: runtime.principal,
    installPath,
    viewId,
    state: "running",
    installedAt: yield* DateTime.nowAsDate,
    lastLaunched: yield* DateTime.nowAsDate,
  };
  return { instance, backend };
});
