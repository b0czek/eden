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
import * as Exit from "effect/Exit";
import type * as Fiber from "effect/Fiber";
import * as FiberSet from "effect/FiberSet";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
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
import {
  type PlatformUtilityProcess,
  type ProcessMetricsPort,
} from "../platform/ports";
import type { SessionContext } from "../session/context";
import type { Views } from "../views/service";
import type { Backends } from "./backends";
import { type AppRuntime, acquireAppInstance } from "./instance";

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
interface InstanceRecord {
  scope: Scope.Closeable;
  runtime: AppRuntime;
  instance?: AppInstance;
  backend?: PlatformUtilityProcess;
  closing: boolean;
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
  const processScope = yield* Effect.scope;
  const instances = new Map<string, InstanceRecord>();
  const admission = new Map<string, Semaphore.Semaphore>();
  function withApp<A, E>(appId: string, work: Effect.Effect<A, E>) {
    return Effect.suspend(() => {
      let lock = admission.get(appId);
      if (!lock) {
        lock = Semaphore.makeUnsafe(1);
        admission.set(appId, lock);
      }
      return lock.withPermit(work);
    });
  }
  function closeInstance(record: InstanceRecord, exit = Exit.void) {
    record.closing = true;
    return Scope.close(record.scope, exit);
  }

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
  yield* listen(backends.backendExit, ({ appId, backend, code }) =>
    handleAppExit(appId, backend, code),
  );
  yield* listen(views.viewLoaded, ({ viewId, appId }) => {
    const port = backends.getFrontendPort(appId);
    const info = views.getViewInfo(viewId);
    if (port && info)
      info.view.webContents.postMessage("backend-port", {}, [port]);
  });
  yield* listen(packages.uninstalled, (change) => {
    if (change.kind === "app" && instances.has(change.packageId))
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
    const state = yield* loadHotReloadServerState(_config);
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
    if (!refreshed || !instances.has(appId)) return;
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

  const launchInstance = Effect.fn(function* (
    appId: string,
    bounds?: { x: number; y: number; width: number; height: number },
    launchArgs?: string[],
    runtime?: AppRuntime,
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
    if (instances.has(appId)) {
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

    const currentUser = _sessionContext.getCurrentUser();
    const resolvedRuntime: AppRuntime = runtime ?? {
      owner: {
        kind: "session" as const,
        sessionId: _sessionContext.getSessionId(),
        username: currentUser?.username ?? null,
      },
      principal: currentUser
        ? ({ kind: "user", username: currentUser.username } as const)
        : ({ kind: "system" } as const),
    };

    if (_shuttingDown)
      return yield* Effect.fail(new Error("Processes are shutting down"));
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const scope = yield* Scope.fork(processScope);
        const record: InstanceRecord = {
          scope,
          runtime: resolvedRuntime,
          closing: false,
        };
        instances.set(appId, record);
        yield* Scope.addFinalizer(
          scope,
          Effect.sync(() => {
            if (instances.get(appId) === record) {
              instances.delete(appId);
              syncRunningAppsState();
            }
          }),
        );
        return yield* restore(
          Scope.provide(
            Effect.gen(function* () {
              const acquired = yield* acquireAppInstance(
                {
                  appId,
                  manifest,
                  installPath,
                  runtime: resolvedRuntime,
                  bounds,
                  launchArgs,
                  launchFile,
                },
                {
                  backends: _backends,
                  views: _views,
                  contexts: _runtimeContexts,
                  channels: _channels,
                },
              );
              if (_shuttingDown)
                return yield* Effect.fail(
                  new Error("Processes are shutting down"),
                );
              record.instance = acquired.instance;
              record.backend = acquired.backend;
              yield* Effect.addFinalizer(() =>
                Effect.sync(() => {
                  record.closing = true;
                }),
              );
              syncRunningAppsState();
              launched.emit({ instance: acquired.instance });
              return {
                success: true,
                instanceId: acquired.instance.instanceId,
                appId,
              };
            }),
            scope,
          ),
        ).pipe(
          Effect.onExit((exit) =>
            Exit.isFailure(exit) ? closeInstance(record) : Effect.void,
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
      }),
    );
  });

  const launchAppInternal = (...args: Parameters<typeof launchInstance>) =>
    withApp(args[0], launchInstance(...args));

  const ensureAppRunning = Effect.fn(
    function* (
      appId: string,
      options: {
        bounds?: { x: number; y: number; width: number; height: number };
        launchArgs?: string[];
      } = {},
    ): Effect.fn.Return<AppInstance, Error> {
      const existing = getAppInstance(appId);
      if (existing) {
        return existing;
      }

      yield* Effect.try({ try: () => assertCanLaunch(appId), catch: asError });
      yield* launchInstance(appId, options.bounds, options.launchArgs);

      const launched = getAppInstance(appId);
      if (!launched) {
        return yield* Effect.fail(
          asError(new Error(`App ${appId} failed to start`)),
        );
      }
      return launched;
    },
    (work, appId) => withApp(appId, work),
  );

  const stopInstance = Effect.fn(function* (
    appId: string,
  ): Effect.fn.Return<void, Error> {
    const record = instances.get(appId);
    if (!record)
      return yield* Effect.fail(new Error(`App ${appId} is not running`));
    yield* Effect.gen(function* () {
      yield* closeInstance(record);
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

  const stopApp = (appId: string) => withApp(appId, stopInstance(appId));

  function getRunningApps(showHidden: boolean = false): AppInstance[] {
    const apps = Array.from(instances.values()).flatMap(({ instance }) =>
      instance ? [instance] : [],
    );
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
    return instances.get(appId)?.instance;
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
    routing.updateRunningApps(
      getRunningApps(true).map((instance) => instance.manifest.id),
    );
  }

  function handleAppError(appId: string, error: unknown): void {
    const instance = getAppInstance(appId);
    if (instance) {
      instance.state = "error";
      processError.emit({ appId, error });
    }
  }

  function handleAppExit(
    appId: string,
    backend: PlatformUtilityProcess,
    code: number,
  ): void {
    routing.removeBackendSubscriptions(appId);
    const record = instances.get(appId);
    if (!record || record.backend !== backend || record.closing) return;
    Queue.offerUnsafe(pending, () =>
      withApp(
        appId,
        Effect.gen(function* () {
          if (instances.get(appId) !== record || record.closing) return;
          yield* closeInstance(record);
          exited.emit({ appId, code });
        }),
      ),
    );
  }

  const shutdown = Effect.fn(function* () {
    _shuttingDown = true;

    _hotReloadWatcher?.close();
    if (_hotReloadDebounceTimer) {
      _hotReloadDebounceTimer.interruptUnsafe();
    }

    const runningAppIds = Array.from(instances.keys());

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
    instances.clear();
    admission.clear();
    _hotReloadStates.clear();
  }

  const reloadApp = Effect.fn(
    function* (appId: string): Effect.fn.Return<void, Error> {
      const instance = getAppInstance(appId);
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

      if (instance.owner.kind === "system") reloading.emit({ appId });
      yield* stopInstance(appId);
      yield* launchInstance(appId, bounds, undefined, {
        owner: instance.owner,
        principal: instance.principal,
        profile: runtime?.profile,
      });

      log.info(`App ${appId} reloaded successfully`);
    },
    (work, appId) => withApp(appId, work),
  );

  const stopSessionApps = Effect.fn(function* (
    sessionId = _sessionContext.getSessionId(),
  ): Effect.fn.Return<void, Error> {
    const running = [...instances.entries()]
      .filter(
        ([
          ,
          {
            runtime: { owner },
          },
        ]) => owner.kind === "session" && owner.sessionId === sessionId,
      )
      .map(([appId]) => appId);
    const errors: unknown[] = [];
    for (const appId of running) {
      yield* withApp(
        appId,
        Effect.suspend(() =>
          instances.has(appId) ? stopInstance(appId) : Effect.void,
        ),
      ).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.sync(() => {
                errors.push(Cause.squash(cause));
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
