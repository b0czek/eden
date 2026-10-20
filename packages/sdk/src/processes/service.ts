import type {
  AppInstance,
  ExecutionPrincipal,
  FilesystemLocation,
  LaunchResult,
  ProcessMetricsSnapshot,
  RuntimeAppManifest,
  UserProfile,
} from "@edenapp/types";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FiberSet from "effect/FiberSet";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import { AppChannelLifecycle } from "../appbus/ports";
import type { Event } from "../events/event";
import { listen, scopedEvent } from "../events/scoped";
import { ExecutionContext } from "../execution/context";
import { RuntimeContexts } from "../execution/runtime-contexts";
import { log } from "../logging";
import { PackageCatalog } from "../packages/catalog";
import { Packages } from "../packages/service";
import type { PlatformUtilityProcess } from "../platform/ports";
import { type Bounds, ProcessMetricsPort } from "../platform/ports/types";
import { RuntimeConfig } from "../runtime/inputs";
import { SessionContext } from "../session/context";
import { ViewNativeFailure } from "../views/errors";
import { Views } from "../views/service";
import { Backends } from "./backends";
import {
  BackendIoFailed,
  BackendTerminationTimedOut,
  type ProcessLaunchError,
  ProcessLaunchRejected,
  type ProcessMetricsError,
  ProcessNotRunning,
  type ProcessStopError,
  ProcessStopFailed,
  SessionProcessesStopFailed,
} from "./errors";
import { watchHotReload } from "./hot-reload";
import { acquireAppInstance } from "./instance";
import { createProcessMetrics } from "./metrics";
import { ProcessesRouting } from "./ports";
import type {
  AppRuntime,
  InstanceRecord,
  ProcessNamespaceEvents,
} from "./types";

export interface Processes {
  launched: Event<{ instance: AppInstance }>;
  stopped: Event<{ appId: string }>;
  reloading: Event<{ appId: string }>;
  error: Event<{ appId: string; error: unknown }>;
  exited: Event<{ appId: string; code: number }>;
  /** @throws ProcessLaunchRejected before operation acceptance. */
  assertCanLaunch: (appId: string) => void;
  launchApp: (
    appId: string,
    bounds?: Bounds | undefined,
    launchArgs?: string[] | undefined,
    launchFile?: FilesystemLocation | undefined,
  ) => Effect.Effect<LaunchResult, ProcessLaunchError>;
  launchDaemon: (
    appId: string,
    principal: ExecutionPrincipal,
    profile?: UserProfile | undefined,
  ) => Effect.Effect<LaunchResult, ProcessLaunchError>;
  ensureAppRunning: (
    appId: string,
  ) => Effect.Effect<AppInstance, ProcessLaunchError>;
  stopApp: (appId: string) => Effect.Effect<void, ProcessStopError>;
  getRunningApps: (showHidden?: boolean) => AppInstance[];
  getAppInstance: (appId: string) => AppInstance | undefined;
  getInstalledManifest: (appId: string) => RuntimeAppManifest | undefined;
  getMetrics: (
    showHidden?: boolean | undefined,
    pollingTimeoutMs?: number | undefined,
    waitForAccurateCpu?: boolean | undefined,
  ) => Effect.Effect<ProcessMetricsSnapshot, ProcessMetricsError>;
  shutdown: () => Effect.Effect<void>;
  reloadApp: (
    appId: string,
  ) => Effect.Effect<void, ProcessLaunchError | ProcessStopError>;
  stopSessionApps: (
    sessionId?: string,
  ) => Effect.Effect<void, SessionProcessesStopFailed>;
}

export const Processes = Context.Service<"eden/Processes", Processes>(
  "eden/Processes",
);

export const ProcessesLive = Layer.effect(
  Processes,
  Effect.gen(function* () {
    const backends = yield* Backends;
    const views = yield* Views;
    const packageCatalog = yield* PackageCatalog;
    const packages = yield* Packages;
    const channels = yield* AppChannelLifecycle;
    const sessionContext = yield* SessionContext;
    const executionContext = yield* ExecutionContext;
    const config = yield* RuntimeConfig;
    const runtimeContexts = yield* RuntimeContexts;
    const processMetrics = yield* ProcessMetricsPort;
    const routing = yield* ProcessesRouting;
    const launched = yield* scopedEvent<ProcessNamespaceEvents["launched"]>();
    const stopped = yield* scopedEvent<ProcessNamespaceEvents["stopped"]>();
    const reloading = yield* scopedEvent<ProcessNamespaceEvents["reloading"]>();
    const processError = yield* scopedEvent<ProcessNamespaceEvents["error"]>();
    const exited = yield* scopedEvent<ProcessNamespaceEvents["exited"]>();
    const forkLifecycle = yield* FiberSet.makeRuntime<never, void, never>();
    function runLifecycle(work: Effect.Effect<unknown, unknown>) {
      forkLifecycle(
        work.pipe(
          Effect.asVoid,
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.failCause(cause).pipe(Effect.orDie)
              : Effect.sync(() =>
                  log.error(
                    "Process lifecycle task failed:",
                    Cause.squash(cause),
                  ),
                ),
          ),
        ),
      );
    }
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
      return Scope.close(record.scope, exit).pipe(
        Effect.catchCause((cause) => {
          // Scope finalizers carry native cleanup failures as defects. Recover only
          // known boundary errors; unexpected defects keep their original channel.
          const expected = cause.reasons.every(
            (reason) =>
              Cause.isDieReason(reason) &&
              (reason.defect instanceof ViewNativeFailure ||
                reason.defect instanceof BackendIoFailed ||
                reason.defect instanceof BackendTerminationTimedOut),
          );
          return expected
            ? Effect.fail(
                new ProcessStopFailed({
                  appId: record.appId,
                  cause: Cause.squash(cause),
                  message: `Failed to stop app ${record.appId}`,
                }),
              )
            : Effect.failCause(cause);
        }),
      );
    }

    let _shuttingDown = false;

    const loginAppId = config.loginAppId;
    const metrics = yield* createProcessMetrics({
      backends,
      views,
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
        runLifecycle(stopApp(change.packageId));
    });
    function canLaunch(appId: string): boolean {
      const developmentApp =
        config.development && packageCatalog.getApp(appId)?.isDevelopment;
      if (
        !developmentApp &&
        !isLoginApp(appId) &&
        !executionContext.canLaunchApp(appId)
      )
        return false;
      return true;
    }
    function assertCanLaunch(appId: string): void {
      if (!canLaunch(appId))
        throw new ProcessLaunchRejected({
          appId,
          reason: "forbidden",
          message: `User cannot launch app ${appId}`,
        });
    }

    const launchApp = Effect.fn(function* (
      appId: string,
      bounds?: { x: number; y: number; width: number; height: number },
      launchArgs?: string[],
      launchFile?: FilesystemLocation,
    ): Effect.fn.Return<LaunchResult, ProcessLaunchError> {
      if (!canLaunch(appId))
        return yield* Effect.fail(
          new ProcessLaunchRejected({
            appId,
            reason: "forbidden",
            message: `User cannot launch app ${appId}`,
          }),
        );

      const currentUser = sessionContext.getCurrentUser();
      return yield* launchAppInternal(
        appId,
        bounds,
        launchArgs,
        {
          owner: {
            kind: "session",
            sessionId: sessionContext.getSessionId(),
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
    ): Effect.fn.Return<LaunchResult, ProcessLaunchError> {
      const manifest = packages.getAppForLaunch(appId);
      if (!manifest?.backend?.entry || manifest.frontend?.entry) {
        return yield* Effect.fail(
          new ProcessLaunchRejected({
            appId,
            reason: "not-daemon",
            message: `App ${appId} is not a backend-only daemon`,
          }),
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
    ): Effect.fn.Return<LaunchResult, ProcessLaunchError> {
      const manifest = packages.getAppForLaunch(appId);
      if (!manifest) {
        return yield* Effect.fail(
          new ProcessLaunchRejected({
            appId,
            reason: "not-installed",
            message: `App ${appId} is not installed`,
          }),
        );
      }

      // Validate manifest has at least frontend or backend
      if (!manifest.frontend?.entry && !manifest.backend?.entry) {
        return yield* Effect.fail(
          new ProcessLaunchRejected({
            appId,
            reason: "invalid-entry",
            message: `App ${appId} must have at least a frontend or backend entry`,
          }),
        );
      }

      // Check if already running
      if (instances.has(appId)) {
        return yield* Effect.fail(
          new ProcessLaunchRejected({
            appId,
            reason: "already-running",
            message: `App ${appId} is already running`,
          }),
        );
      }

      // Get the correct install path
      const installPath = packageCatalog.getPath(appId);
      if (!installPath) {
        return yield* Effect.fail(
          new ProcessLaunchRejected({
            appId,
            reason: "missing-path",
            message: `App path not found for ${appId}`,
          }),
        );
      }

      const currentUser = sessionContext.getCurrentUser();
      const resolvedRuntime: AppRuntime = runtime ?? {
        owner: {
          kind: "session" as const,
          sessionId: sessionContext.getSessionId(),
          username: currentUser?.username ?? null,
        },
        principal: currentUser
          ? ({ kind: "user", username: currentUser.username } as const)
          : ({ kind: "system" } as const),
      };

      if (_shuttingDown)
        return yield* Effect.fail(
          new ProcessLaunchRejected({
            appId,
            reason: "shutting-down",
            message: "Processes are shutting down",
          }),
        );
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const scope = yield* Scope.fork(processScope);
          const record: InstanceRecord = {
            appId,
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
                    backends,
                    views,
                    contexts: runtimeContexts,
                    channels,
                  },
                );
                if (_shuttingDown)
                  return yield* Effect.fail(
                    new ProcessLaunchRejected({
                      appId,
                      reason: "shutting-down",
                      message: "Processes are shutting down",
                    }),
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
              Exit.isFailure(exit)
                ? closeInstance(record).pipe(Effect.orDie)
                : Effect.void,
            ),
            Effect.tapError((error) =>
              Effect.sync(() =>
                log.error(`Failed to launch app ${appId}:`, error),
              ),
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
      ): Effect.fn.Return<AppInstance, ProcessLaunchError> {
        const existing = getAppInstance(appId);
        if (existing) {
          return existing;
        }

        if (!canLaunch(appId))
          return yield* Effect.fail(
            new ProcessLaunchRejected({
              appId,
              reason: "forbidden",
              message: `User cannot launch app ${appId}`,
            }),
          );
        yield* launchInstance(appId, options.bounds, options.launchArgs);

        const launched = getAppInstance(appId);
        if (!launched) {
          return yield* Effect.fail(
            new ProcessLaunchRejected({
              appId,
              reason: "invalid-entry",
              message: `App ${appId} failed to start`,
            }),
          );
        }
        return launched;
      },
      (work, appId) => withApp(appId, work),
    );

    const stopInstance = Effect.fn(function* (
      appId: string,
    ): Effect.fn.Return<void, ProcessStopError> {
      const record = instances.get(appId);
      if (!record)
        return yield* Effect.fail(
          new ProcessNotRunning({
            appId,
            message: `App ${appId} is not running`,
          }),
        );
      yield* Effect.gen(function* () {
        yield* closeInstance(record);
        stopped.emit({ appId });
      }).pipe(
        Effect.tapError((error) =>
          Effect.sync(() => log.error(`Failed to stop app ${appId}:`, error)),
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
      return packageCatalog.getApp(appId);
    }

    const getMetrics = Effect.fn(function* (
      showHidden: boolean = false,
      pollingTimeoutMs?: number,
      waitForAccurateCpu: boolean = true,
    ): Effect.fn.Return<ProcessMetricsSnapshot, ProcessMetricsError> {
      return yield* metrics.getMetrics(
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
      runLifecycle(
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

    const shutdown = Effect.uninterruptible(
      yield* Effect.cached(
        Effect.gen(function* () {
          _shuttingDown = true;

          yield* stopHotReload;

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
                  ? Effect.failCause(cause).pipe(Effect.orDie)
                  : Effect.sync(() => {
                      const error = Cause.squash(cause);
                      log.error(`Failed to stop app ${appId}:`, error);
                    }),
              ),
            );
          }
        }),
      ),
    );

    function dispose(): void {
      instances.clear();
      admission.clear();
    }

    const reloadApp = Effect.fn(
      function* (
        appId: string,
      ): Effect.fn.Return<void, ProcessLaunchError | ProcessStopError> {
        const instance = getAppInstance(appId);
        if (!instance) {
          log.info(`App ${appId} is not running, skipping reload`);
          return;
        }

        // Save the current view bounds
        const viewInfo = views.getViewInfo(instance.viewId);
        const bounds = viewInfo ? viewInfo.view.getBounds() : undefined;

        log.info(`Reloading app ${appId}...`);

        // A hot-reload watcher runs outside the request's caller context.
        // Preserve the running process identity before stopApp removes it
        // so relaunch does not depend on ambient user authorization state.
        const runtime = runtimeContexts.get(appId);

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
      sessionId: string = sessionContext.getSessionId(),
    ): Effect.fn.Return<void, SessionProcessesStopFailed> {
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
      const errors: ProcessStopError[] = [];
      for (const appId of running) {
        yield* withApp(
          appId,
          Effect.suspend(() =>
            instances.has(appId) ? stopInstance(appId) : Effect.void,
          ),
        ).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              errors.push(error);
            }),
          ),
        );
      }
      if (errors.length)
        return yield* Effect.fail(
          new SessionProcessesStopFailed({
            sessionId,
            cause: new AggregateError(errors),
            message: "Failed to stop all session apps",
          }),
        );
    });

    function isLoginApp(appId: string): boolean {
      return !!loginAppId && appId === loginAppId;
    }
    let stopHotReload: Effect.Effect<void> = Effect.void;
    yield* Effect.addFinalizer(() =>
      shutdown.pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() =>
            log.error("Failed to stop process lifecycle:", Cause.squash(cause)),
          ),
        ),
        Effect.ensuring(Effect.sync(dispose)),
      ),
    );
    stopHotReload = yield* watchHotReload({
      config,
      packages,
      isRunning: (appId) => instances.has(appId),
      isShuttingDown: () => _shuttingDown,
      reloadApp,
      runLifecycle,
    }).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.sync(() =>
              log.error(
                "Failed to watch hot reload state:",
                Cause.squash(cause),
              ),
            ).pipe(Effect.as(Effect.void)),
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
      shutdown: () => shutdown,
      reloadApp,
      stopSessionApps,
    };
  }),
);
