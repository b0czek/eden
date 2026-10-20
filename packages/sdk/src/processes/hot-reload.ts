import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import type { EdenConfig } from "@edenapp/types";
import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberHandle from "effect/FiberHandle";
import * as Semaphore from "effect/Semaphore";
import { fromPromise } from "../effects/io";
import {
  getHotReloadServersPath,
  isHotReloadConfigured,
  loadHotReloadServerState,
} from "../hotreload-config";
import { log } from "../logging";
import type { Packages } from "../packages/service";
import { HotReloadWatchFailed } from "./errors";

/** Owns filesystem notifications, debounce, and manifest refresh for this scope. */
export const watchHotReload = Effect.fn(function* ({
  config,
  packages,
  isRunning,
  isShuttingDown,
  reloadApp,
  runLifecycle,
}: {
  config: EdenConfig;
  packages: Pick<Packages, "reloadPackage">;
  isRunning(appId: string): boolean;
  isShuttingDown(): boolean;
  reloadApp(appId: string): Effect.Effect<void, unknown>;
  runLifecycle(work: Effect.Effect<unknown, unknown>): void;
}) {
  let _hotReloadStates = new Map<string, string>();
  const hotReload = yield* Semaphore.make(1);
  const hotReloadDebounce = yield* FiberHandle.make<void, never>();
  const forkHotReload = yield* FiberHandle.runtime(hotReloadDebounce)<never>();
  const setupHotReloadWatcher = Effect.fn(function* () {
    if (!isHotReloadConfigured(config)) return;
    const serversPath = getHotReloadServersPath(config);
    const stateDirectory = path.dirname(serversPath);
    const watchFailure = (cause: unknown) =>
      new HotReloadWatchFailed({
        path: stateDirectory,
        cause,
        message: `Failed to watch hot reload state at ${stateDirectory}`,
      });
    yield* fromPromise(
      () => fsp.mkdir(stateDirectory, { recursive: true }),
      watchFailure,
    );
    yield* Effect.acquireRelease(
      Effect.try({
        try: () =>
          fs.watch(stateDirectory, (eventType, filename) => {
            if (
              isShuttingDown() ||
              (eventType !== "rename" && eventType !== "change")
            )
              return;
            if (filename && filename.toString() !== path.basename(serversPath))
              return;
            forkHotReload(
              Effect.sleep(
                Duration.millis(
                  Math.max(config.hotReload?.debounce ?? 300, 50),
                ),
              ).pipe(
                Effect.andThen(
                  Effect.sync(() => {
                    runLifecycle(handleHotReloadStateChanged());
                  }),
                ),
              ),
            );
          }),
        catch: watchFailure,
      }),
      (watcher) => Effect.sync(() => watcher.close()),
    );
    runLifecycle(handleHotReloadStateChanged());
  });
  const handleHotReloadStateChanged = Effect.fn(
    function* () {
      const state = yield* loadHotReloadServerState(config);
      const appIds = new Set([
        ..._hotReloadStates.keys(),
        ...Object.keys(state.apps),
      ]);
      const nextStates = new Map<string, string>();

      for (const appId of appIds) {
        const appState = state.apps[appId];
        nextStates.set(
          appId,
          `${appState?.status}:${appState?.url}:${appState?.revision ?? 0}`,
        );
      }

      const changedAppIds = Array.from(appIds).filter(
        (appId) => _hotReloadStates.get(appId) !== nextStates.get(appId),
      );

      _hotReloadStates = nextStates;

      for (const appId of changedAppIds) {
        yield* refreshHotReloadApp(appId);
      }
    },
    (work) => hotReload.withPermit(work),
  );

  const refreshHotReloadApp = Effect.fn(function* (appId: string) {
    const refreshed = yield* packages.reloadPackage(appId).pipe(
      Effect.match({
        onSuccess: () => true,
        onFailure: (error) => {
          log.warn(
            `Failed to refresh hot reload manifest for ${appId}:`,
            error,
          );
          return false;
        },
      }),
    );
    if (!refreshed || !isRunning(appId)) return;
    yield* reloadApp(appId).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.sync(() =>
              log.error(
                `Failed to reload hot reload app ${appId}:`,
                Cause.squash(cause),
              ),
            ),
      ),
    );
  });

  yield* setupHotReloadWatcher();
  return FiberHandle.clear(hotReloadDebounce);
});
