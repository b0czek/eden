import * as path from "node:path";
import type { EdenConfig } from "@edenapp/types";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FiberHandle from "effect/FiberHandle";
import * as FiberSet from "effect/FiberSet";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import { logBackgroundFailure } from "../../core/effects/failure-policy";
import {
  getHotReloadServersPath,
  isHotReloadConfigured,
  loadHotReloadServerState,
} from "../../hotreload-config";
import { io } from "../../platform/filesystem/native-io";
import { log } from "../../platform/logging/logger";
import type { Packages } from "../packages/service";
import type { ProcessLaunchError, ProcessStopError } from "./errors";

interface HotReloadDependencies {
  config: EdenConfig;
  packages: Pick<Packages, "reloadPackage">;
  isRunning(appId: string): boolean;
  reloadApp(
    appId: string,
  ): Effect.Effect<void, ProcessLaunchError | ProcessStopError>;
}

/** Closing this scope stops the watcher, debounce, and in-flight reload work. */
export const watchHotReload = Effect.fn(function* (
  dependencies: HotReloadDependencies,
) {
  if (!isHotReloadConfigured(dependencies.config)) return Effect.void;
  const scope = yield* Scope.fork(yield* Effect.scope);
  const stop = Scope.close(scope, Exit.void);
  yield* acquireHotReloadWatcher(dependencies).pipe(
    Scope.provide(scope),
    Effect.onError(() => stop),
  );
  return stop;
});

const acquireHotReloadWatcher = Effect.fn(function* ({
  config,
  packages,
  isRunning,
  reloadApp,
}: HotReloadDependencies) {
  const forkReload = yield* FiberSet.makeRuntime<never, void, never>();
  function refresh() {
    forkReload(
      handleHotReloadStateChanged().pipe(
        Effect.asVoid,
        logBackgroundFailure("Hot reload task failed:"),
      ),
    );
  }
  let _hotReloadStates = new Map<string, string>();
  const hotReload = yield* Semaphore.make(1);
  const hotReloadDebounce = yield* FiberHandle.make<void, never>();
  const forkHotReload = yield* FiberHandle.runtime(hotReloadDebounce)<never>();
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
      logBackgroundFailure(`Failed to reload hot reload app ${appId}:`),
    );
  });

  const serversPath = getHotReloadServersPath(config);
  const stateDirectory = path.dirname(serversPath);
  yield* io.mkdir(stateDirectory, { recursive: true });
  yield* Effect.acquireRelease(
    io.watch(
      stateDirectory,
      (eventType, filename) => {
        if (eventType !== "rename" && eventType !== "change") return;
        if (filename && filename.toString() !== path.basename(serversPath))
          return;
        forkHotReload(
          Effect.sleep(
            Duration.millis(Math.max(config.hotReload?.debounce ?? 300, 50)),
          ).pipe(Effect.andThen(Effect.sync(refresh))),
        );
      },
      (error) => log.warn("Hot reload watch failed:", error),
      { persistent: true },
    ),
    (watcher) => Effect.sync(() => watcher.close()),
  );
  refresh();
});
