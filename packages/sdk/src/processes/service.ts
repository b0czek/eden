import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import type {
  AppInstance,
  EdenConfig,
  ExecutionPrincipal,
  FilesystemLocation,
  LaunchResult,
  ProcessMetricsSnapshot,
  ProcessOwner,
  UserProfile,
} from "@edenapp/types";
import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import type * as Fiber from "effect/Fiber";
import * as FiberSet from "effect/FiberSet";
import * as Queue from "effect/Queue";
import { type AppChannelLifecycle } from "../appbus/ports";
import { asError, fromPromise } from "../effects/io";
import { listen, scopedEvent } from "../events/scoped";
import type { ExecutionContext } from "../execution/context";
import type { RuntimeContexts } from "../execution/runtime-contexts";
import {
  getHotReloadServersPath,
  isHotReloadConfigured,
  loadHotReloadServerState,
} from "../hotreload-config";

import { log } from "../logging";
import type { PackageCatalog } from "../packages/catalog";
import type { Packages } from "../packages/service";
import { type ProcessMetricsPort } from "../platform/ports";
import type { SessionContext } from "../session/context";
import type { Views } from "../views/service";
import type { Backends } from "./backends";

import { createProcessMetrics, type ProcessMetrics } from "./metrics";

/**
 * Events emitted by the Processes
 */
interface ProcessNamespaceEvents {
  launched: { instance: AppInstance };
  stopped: { appId: string };
  reloading: { appId: string };
  error: { appId: string; error: unknown };
  exited: { appId: string; code: number };
}
export interface ProcessesDependencies {
  backends: Backends;
  views: Views;
  packageCatalog: PackageCatalog;
  packages: Packages;
  channels: AppChannelLifecycle;
  sessionContext: SessionContext;
  executionContext: ExecutionContext;
  config: EdenConfig;
  runtimeContexts: RuntimeContexts;
  processMetrics: ProcessMetricsPort;
  routing: {
    updateRunningApps(appIds: Iterable<string>): void;
    removeBackendSubscriptions(appId: string): void;
  };
}
export const createProcesses = Effect.fn(function* ({
  backends,
  views,
  packageCatalog,
  packages,
  channels,
  sessionContext,
  executionContext,
  config,
  runtimeContexts,
  processMetrics,
  routing,
}: ProcessesDependencies) {
  const launched = yield* scopedEvent<ProcessNamespaceEvents["launched"]>();
  const stopped = yield* scopedEvent<ProcessNamespaceEvents["stopped"]>();
  const reloading = yield* scopedEvent<ProcessNamespaceEvents["reloading"]>();
  const processError = yield* scopedEvent<ProcessNamespaceEvents["error"]>();
  const exited = yield* scopedEvent<ProcessNamespaceEvents["exited"]>();
  const pending =
    yield* Queue.unbounded<() => Effect.Effect<unknown, unknown>>();
  let _runningApps: Map<string, AppInstance> = new Map();

  let _processMetrics: ProcessMetrics;
  let _loginAppId: string | undefined;
  let _hotReloadStates = new Map<string, string>();
  let _hotReloadWatcher: fs.FSWatcher | undefined;

  const forkHotReload = yield* FiberSet.makeRuntime<never, void, never>();
  let _hotReloadDebounceTimer: Fiber.Fiber<void> | undefined;
  let _shuttingDown = false;
  const _backends = backends;
  const _views = views;
  const _packageCatalog = packageCatalog;
  const _packages = packages;
  const _channels = channels;
  const _sessionContext = sessionContext;
  const _executionContext = executionContext;
  const _config = config;
  const _runtimeContexts = runtimeContexts;

  _loginAppId = _config.loginAppId;
  _processMetrics = yield* createProcessMetrics({
    backends: _backends,
    views: _views,
    getRunningApps: (showHidden) => getRunningApps(showHidden),
    processMetrics,
  });

  yield* listen(backends.backendError, ({ appId, error }) =>
    handleAppError(appId, error),
  );
  yield* listen(backends.backendExit, ({ appId, code }) =>
    handleAppExit(appId, code),
  );
  yield* listen(views.viewLoaded, ({ viewId, appId }) => {
    const port = backends.getFrontendPort(appId);
    const info = views.getViewInfo(viewId);
    if (port && info)
      info.view.webContents.postMessage("backend-port", {}, [port]);
  });
  yield* listen(packages.uninstalled, (change) => {
    if (change.kind === "app" && _runningApps.has(change.packageId))
      Queue.offerUnsafe(pending, () => stopApp(change.packageId));
  });
  const setupHotReloadWatcher = Effect.fn(function* () {
    if (!isHotReloadConfigured(config)) return;
    const serversPath = getHotReloadServersPath(config);
    const stateDirectory = path.dirname(serversPath);
    yield* fromPromise(() => fsp.mkdir(stateDirectory, { recursive: true }));
    _hotReloadWatcher = fs.watch(stateDirectory, (eventType, filename) => {
      if (_shuttingDown || (eventType !== "rename" && eventType !== "change"))
        return;
      if (filename && filename.toString() !== path.basename(serversPath))
        return;
      _hotReloadDebounceTimer?.interruptUnsafe();
      _hotReloadDebounceTimer = forkHotReload(
        Effect.sleep(
          Duration.millis(Math.max(config.hotReload?.debounce ?? 300, 50)),
        ).pipe(
          Effect.andThen(
            Effect.sync(() => {
              Queue.offerUnsafe(pending, handleHotReloadStateChanged);
            }),
          ),
        ),
      );
    });
    Queue.offerUnsafe(pending, handleHotReloadStateChanged);
  });
  const handleHotReloadStateChanged = Effect.fn(function* () {
    const state = yield* fromPromise(() => loadHotReloadServerState(_config));
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
  });

  const refreshHotReloadApp = Effect.fn(function* (appId: string) {
    const refreshed = yield* _packages.reloadPackage(appId).pipe(
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
    if (!refreshed || !_runningApps.has(appId)) return;
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

  function assertCanLaunch(appId: string): void {
    const developmentApp =
      _config.development && _packageCatalog.getApp(appId)?.isDevelopment;
    if (
      !developmentApp &&
      !isLoginApp(appId) &&
      !_executionContext.canLaunchApp(appId)
    ) {
      throw new Error(`User cannot launch app ${appId}`);
    }
  }

  const launchApp = Effect.fn(function* (
    appId: string,
    bounds?: { x: number; y: number; width: number; height: number },
    launchArgs?: string[],
    launchFile?: FilesystemLocation,
  ): Effect.fn.Return<LaunchResult, Error> {
    yield* Effect.try({ try: () => assertCanLaunch(appId), catch: asError });

    const currentUser = _sessionContext.getCurrentUser();
    return yield* launchAppInternal(
      appId,
      bounds,
      launchArgs,
      {
        owner: {
          kind: "session",
          sessionId: _sessionContext.getSessionId(),
          username: currentUser?.username ?? null,
        },
        principal: currentUser
          ? { kind: "user", username: currentUser.username }
          : { kind: "system" },
      },
      launchFile
        ? { volume: launchFile.volume, path: launchFile.path }
        : undefined,
    );
  });

  const launchDaemon = Effect.fn(function* (
    appId: string,
    principal: ExecutionPrincipal,
    profile?: UserProfile,
  ): Effect.fn.Return<LaunchResult, Error> {
    const manifest = _packages.getAppForLaunch(appId);
    if (!manifest?.backend?.entry || manifest.frontend?.entry) {
      return yield* Effect.fail(
        asError(new Error(`App ${appId} is not a backend-only daemon`)),
      );
    }
    return yield* launchAppInternal(appId, undefined, undefined, {
      owner: { kind: "system" },
      principal,
      profile,
    });
  });

  const launchAppInternal = Effect.fn(function* (
    appId: string,
    bounds?: { x: number; y: number; width: number; height: number },
    launchArgs?: string[],
    runtime?: {
      owner: ProcessOwner;
      principal: ExecutionPrincipal;
      profile?: UserProfile;
    },
    launchFile?: FilesystemLocation,
  ): Effect.fn.Return<LaunchResult, Error> {
    const manifest = _packages.getAppForLaunch(appId);
    if (!manifest) {
      return yield* Effect.fail(
        asError(new Error(`App ${appId} is not installed`)),
      );
    }

    // Validate manifest has at least frontend or backend
    if (!manifest.frontend?.entry && !manifest.backend?.entry) {
      return yield* Effect.fail(
        asError(
          new Error(
            `App ${appId} must have at least a frontend or backend entry`,
          ),
        ),
      );
    }

    // Check if already running
    if (_runningApps.has(appId)) {
      return yield* Effect.fail(
        asError(new Error(`App ${appId} is already running`)),
      );
    }

    // Get the correct install path
    const installPath = _packageCatalog.getPath(appId);
    if (!installPath) {
      return yield* Effect.fail(
        asError(new Error(`App path not found for ${appId}`)),
      );
    }

    const instanceId = randomUUID();
    const currentUser = _sessionContext.getCurrentUser();
    const resolvedRuntime: {
      owner: ProcessOwner;
      principal: ExecutionPrincipal;
      profile?: UserProfile;
    } = runtime ?? {
      owner: {
        kind: "session" as const,
        sessionId: _sessionContext.getSessionId(),
        username: currentUser?.username ?? null,
      },
      principal: currentUser
        ? ({ kind: "user", username: currentUser.username } as const)
        : ({ kind: "system" } as const),
    };

    _runtimeContexts.register(appId, {
      owner: resolvedRuntime.owner,
      principal: resolvedRuntime.principal,
      profile: resolvedRuntime.profile,
    });

    return yield* Effect.gen(function* () {
      // Create backend utility process if one is defined
      if (manifest.backend?.entry) {
        yield* _backends.createBackend(
          appId,
          manifest,
          installPath,
          launchArgs,
          launchFile,
        );
      }

      // Create view for frontend only if frontend is defined
      let viewId: number | undefined;
      if (manifest.frontend?.entry) {
        viewId = _views.createView(
          appId,
          manifest,
          installPath,
          bounds,
          launchArgs,
          launchFile,
        );
      }

      // Create app instance
      const instance: AppInstance = {
        manifest,
        instanceId,
        owner: resolvedRuntime.owner,
        principal: resolvedRuntime.principal,
        installPath,
        viewId: viewId ?? -1, // -1 indicates no view (backend-only)
        state: "running",
        installedAt: new Date(),
        lastLaunched: new Date(),
      };

      _runningApps.set(appId, instance);
      syncRunningAppsState();

      launched.emit({ instance });

      // Return serializable data only
      return {
        success: true,
        instanceId,
        appId,
      };
    }).pipe(
      Effect.onError(() =>
        Effect.sync(() => _runtimeContexts.unregister(appId)),
      ),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.gen(function* () {
              const error = Cause.squash(cause);
              log.error(`Failed to launch app ${appId}:`, error);
              return yield* Effect.fail(asError(error));
            }),
      ),
    );
  });

  const ensureAppRunning = Effect.fn(function* (
    appId: string,
    options: {
      bounds?: { x: number; y: number; width: number; height: number };
      launchArgs?: string[];
    } = {},
  ): Effect.fn.Return<AppInstance, Error> {
    const existing = _runningApps.get(appId);
    if (existing) {
      return existing;
    }

    yield* launchApp(appId, options.bounds, options.launchArgs);

    const launched = _runningApps.get(appId);
    if (!launched) {
      return yield* Effect.fail(
        asError(new Error(`App ${appId} failed to start`)),
      );
    }
    return launched;
  });

  const stopApp = Effect.fn(function* (
    appId: string,
  ): Effect.fn.Return<void, Error> {
    const instance = _runningApps.get(appId);
    if (!instance) {
      return yield* Effect.fail(
        asError(new Error(`App ${appId} is not running`)),
      );
    }

    yield* Effect.gen(function* () {
      // Unregister all services exposed by this app
      _channels.unregisterAllServices(appId);

      // Remove view first (before backend termination to avoid race)
      if (instance.viewId !== -1) {
        _views.removeView(instance.viewId);
      }

      // Terminate backend after view is removed
      if (_backends.hasBackend(appId)) {
        yield* _backends.terminateBackend(appId);
      }

      // Remove from running apps
      _runningApps.delete(appId);
      _runtimeContexts.unregister(appId);
      syncRunningAppsState();

      stopped.emit({ appId });
    }).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.gen(function* () {
              const error = Cause.squash(cause);
              log.error(`Failed to stop app ${appId}:`, error);
              return yield* Effect.fail(asError(error));
            }),
      ),
    );
  });

  function getRunningApps(showHidden: boolean = false): AppInstance[] {
    const apps = Array.from(_runningApps.values());
    return showHidden
      ? apps
      : apps.filter(
          (app) =>
            (app.manifest.hidden !== undefined
              ? !app.manifest.hidden
              : !app.manifest.overlay) && !!app.manifest.frontend?.entry,
        );
  }

  function getAppInstance(appId: string): AppInstance | undefined {
    return _runningApps.get(appId);
  }

  function getInstalledManifest(appId: string) {
    return _packageCatalog.getApp(appId);
  }

  const getMetrics = Effect.fn(function* (
    showHidden: boolean = false,
    pollingTimeoutMs?: number,
    waitForAccurateCpu: boolean = true,
  ): Effect.fn.Return<ProcessMetricsSnapshot, Error> {
    return yield* _processMetrics.getMetrics(
      showHidden,
      pollingTimeoutMs,
      waitForAccurateCpu,
    );
  });

  function syncRunningAppsState(): void {
    routing.updateRunningApps(_runningApps.keys());
  }

  function handleAppError(appId: string, error: unknown): void {
    const instance = _runningApps.get(appId);
    if (instance) {
      instance.state = "error";
      processError.emit({ appId, error });
    }
  }

  function handleAppExit(appId: string, code: number): void {
    routing.removeBackendSubscriptions(appId);
    const instance = _runningApps.get(appId);
    if (!instance) {
      // App was already cleaned up by stopApp(), nothing to do
      return;
    }

    // Unregister all services exposed by this app
    _channels.unregisterAllServices(appId);

    // Clean up view (only if frontend exists, viewId !== -1)
    if (instance.viewId !== -1) {
      try {
        _views.removeView(instance.viewId);
      } catch (_e) {
        // View may already be removed
      }
    }

    _runningApps.delete(appId);
    _runtimeContexts.unregister(appId);
    syncRunningAppsState();

    exited.emit({ appId, code });
  }

  const shutdown = Effect.fn(function* () {
    _shuttingDown = true;

    _hotReloadWatcher?.close();
    if (_hotReloadDebounceTimer) {
      _hotReloadDebounceTimer.interruptUnsafe();
    }

    const runningAppIds = Array.from(_runningApps.keys());

    log.info(`Stopping ${runningAppIds.length} running app(s)...`);

    // Stop all apps sequentially and wait for each to complete
    for (const appId of runningAppIds) {
      yield* Effect.gen(function* () {
        log.info(`Stopping app: ${appId}`);
        yield* stopApp(appId);
        log.info(`✓ Stopped app: ${appId}`);
      }).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.sync(() => {
                const error = Cause.squash(cause);
                log.error(`Failed to stop app ${appId}:`, error);
              }),
        ),
      );
    }
  });

  function dispose(): void {
    _shuttingDown = true;
    _hotReloadWatcher?.close();
    _hotReloadWatcher = undefined;
    if (_hotReloadDebounceTimer) {
      _hotReloadDebounceTimer.interruptUnsafe();
      _hotReloadDebounceTimer = undefined;
    }
    _runningApps.clear();
    _hotReloadStates.clear();
  }

  const reloadApp = Effect.fn(function* (
    appId: string,
  ): Effect.fn.Return<void, Error> {
    const instance = _runningApps.get(appId);
    if (!instance) {
      log.info(`App ${appId} is not running, skipping reload`);
      return;
    }

    // Save the current view bounds
    const viewInfo = _views.getViewInfo(instance.viewId);
    const bounds = viewInfo ? viewInfo.view.getBounds() : undefined;

    log.info(`Reloading app ${appId}...`);

    // A hot-reload watcher runs outside the request's AsyncLocalStorage
    // context. Preserve the running process identity before stopApp removes it
    // so relaunch does not depend on ambient user authorization state.
    const runtime = _runtimeContexts.get(appId);

    // Stop the app
    if (instance.owner.kind === "system") {
      reloading.emit({ appId });
      yield* stopApp(appId);
      yield* launchDaemon(appId, instance.principal, runtime?.profile);
    } else {
      yield* stopApp(appId);

      // Small delay to ensure cleanup
      yield* Effect.sleep(Duration.millis(100));

      // Relaunch with the same bounds and the identity of the process that was
      // already authorized to run.
      yield* launchAppInternal(appId, bounds, undefined, {
        owner: instance.owner,
        principal: instance.principal,
        profile: runtime?.profile,
      });
    }

    log.info(`App ${appId} reloaded successfully`);
  });

  const stopSessionApps = Effect.fn(function* (
    sessionId = _sessionContext.getSessionId(),
  ): Effect.fn.Return<void, Error> {
    const running = Array.from(_runningApps.values())
      .filter(
        (instance) =>
          instance.owner.kind === "session" &&
          instance.owner.sessionId === sessionId,
      )
      .map((instance) => instance.manifest.id);
    const errors: unknown[] = [];
    for (const appId of running) {
      yield* Effect.gen(function* () {
        yield* stopApp(appId);
      }).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.sync(() => {
                const error = Cause.squash(cause);
                // A process may exit on its own after the snapshot was taken.
                if (_runningApps.has(appId)) {
                  errors.push(error);
                }
              }),
        ),
      );
    }

    if (errors.length > 0) {
      return yield* Effect.fail(
        asError(new AggregateError(errors, "Failed to stop all session apps")),
      );
    }
  });

  function isLoginApp(appId: string): boolean {
    return !!_loginAppId && appId === _loginAppId;
  }
  yield* Effect.forkScoped(
    Effect.forever(
      Effect.flatMap(Queue.take(pending), (work) =>
        work().pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.failCause(cause)
              : Effect.sync(() =>
                  log.error(
                    "Process lifecycle task failed:",
                    Cause.squash(cause),
                  ),
                ),
          ),
        ),
      ),
    ),
  );
  yield* Effect.addFinalizer(() =>
    shutdown().pipe(
      Effect.catchCause((cause) =>
        Effect.sync(() =>
          log.error("Failed to stop process lifecycle:", Cause.squash(cause)),
        ),
      ),
      Effect.ensuring(Effect.sync(dispose)),
    ),
  );
  yield* setupHotReloadWatcher().pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.failCause(cause)
        : Effect.sync(() =>
            log.error("Failed to watch hot reload state:", Cause.squash(cause)),
          ),
    ),
  );
  return {
    launched,
    stopped,
    reloading,
    error: processError,
    exited,
    assertCanLaunch,
    launchApp,
    launchDaemon,
    ensureAppRunning,
    stopApp,
    getRunningApps,
    getAppInstance,
    getInstalledManifest,
    getMetrics,
    shutdown,
    reloadApp,
    stopSessionApps,
  };
});

export type Processes = Effect.Success<ReturnType<typeof createProcesses>>;
