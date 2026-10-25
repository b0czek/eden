import type {
  AppInstance,
  ExecutionPrincipal,
  FilesystemLocation,
  LaunchResult,
  ProcessMetricsSnapshot,
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
import {
  logBackgroundFailure,
  logCleanupFailure,
} from "../../core/effects/failure-policy";
import type { Event } from "../../core/events/event";
import { listen, scopedEvent } from "../../core/events/scoped";
import {
  type CommandCallerContext,
  ExecutionContext,
} from "../../core/execution/context";
import { RuntimeContexts } from "../../core/execution/runtime-contexts";
import { SessionContext } from "../../desktop/session/context";
import { Views } from "../../desktop/views/service";
import { log } from "../../platform/logging/logger";
import {
  type Bounds,
  type PlatformUtilityProcess,
  ProcessMetricsPort,
} from "../../platform/ports/types";
import { RuntimeConfig } from "../../runtime/inputs";
import { AppChannels } from "../appbus/service";
import { PackageCatalog } from "../packages/catalog";
import { Packages } from "../packages/service";
import { Backends } from "./backends";
import {
  BackendStartupFailed,
  type ProcessLaunchError,
  ProcessLaunchRejected,
  type ProcessMetricsError,
  ProcessNotRunning,
  type ProcessStopError,
  ProcessStopFailed,
  ProcessStopRejected,
  SessionProcessesStopFailed,
} from "./errors";
import { watchHotReload } from "./hot-reload";
import { acquireAppInstance } from "./instance";
import { createProcessMetrics } from "./metrics";
import type {
  AppRuntime,
  InstanceRecord,
  LaunchRequest,
  ProcessEvents,
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
  /** Check caller ownership under the app lock; omit caller for trusted lifecycle cleanup. */
  stopApp: (
    appId: string,
    caller?: CommandCallerContext,
  ) => Effect.Effect<void, ProcessStopError>;
  /** Capture the originating instance before acceptance; exit only that instance under the app lock.
   * @throws ProcessNotRunning before operation acceptance.
   */
  prepareExit: (appId: string) => Effect.Effect<void, ProcessStopError>;
  getRunningApps: (showHidden?: boolean) => AppInstance[];
  getAppInstance: (appId: string) => AppInstance | undefined;
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
    const channels = yield* AppChannels;
    const sessionContext = yield* SessionContext;
    const executionContext = yield* ExecutionContext;
    const config = yield* RuntimeConfig;
    const runtimeContexts = yield* RuntimeContexts;
    const processMetrics = yield* ProcessMetricsPort;
    const launched = yield* scopedEvent<ProcessEvents["launched"]>();
    const stopped = yield* scopedEvent<ProcessEvents["stopped"]>();
    const reloading = yield* scopedEvent<ProcessEvents["reloading"]>();
    const processError = yield* scopedEvent<ProcessEvents["error"]>();
    const exited = yield* scopedEvent<ProcessEvents["exited"]>();
    const forkLifecycle = yield* FiberSet.makeRuntime<never, void, never>();
    function runLifecycle<A, E>(work: Effect.Effect<A, E>) {
      forkLifecycle(
        work.pipe(
          Effect.asVoid,
          logBackgroundFailure("Process lifecycle task failed:"),
        ),
      );
    }
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
    function closeInstance(
      record: InstanceRecord,
      exit: Exit.Exit<unknown, unknown> = Exit.void,
    ): Effect.Effect<void, ProcessStopFailed> {
      return Effect.sync(() => {
        record.closing = true;
        channels.unregisterAllServices(record.appId);
      }).pipe(
        Effect.ensuring(Scope.close(record.scope, exit)),
        Effect.catchCause((cause) =>
          Effect.fail(
            new ProcessStopFailed({
              appId: record.appId,
              cause,
              message: `Failed to stop app ${record.appId}`,
            }),
          ),
        ),
        Effect.uninterruptible,
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

    function rejectLaunch(
      appId: string,
      reason: ProcessLaunchRejected["reason"],
    ) {
      const messages = {
        forbidden: `User cannot launch app ${appId}`,
        "not-installed": `App ${appId} is not installed`,
        "invalid-entry": `App ${appId} must have at least a frontend or backend entry`,
        "not-daemon": `App ${appId} is not a backend-only daemon`,
        "already-running": `App ${appId} is already running`,
        "missing-path": `App path not found for ${appId}`,
        "shutting-down": "Processes are shutting down",
      };
      return Effect.fail(
        new ProcessLaunchRejected({ appId, reason, message: messages[reason] }),
      );
    }

    function sessionRuntime(): AppRuntime {
      const user = sessionContext.getCurrentUser();
      return {
        owner: {
          kind: "session",
          sessionId: sessionContext.getSessionId(),
          username: user?.username ?? null,
        },
        principal: user
          ? { kind: "user", username: user.username }
          : { kind: "system" },
      };
    }

    function launchResult(instance: AppInstance): LaunchResult {
      return {
        success: true,
        appId: instance.manifest.id,
        instanceId: instance.instanceId,
      };
    }

    const launchApp = Effect.fn(function* (
      appId: string,
      bounds?: Bounds,
      launchArgs?: string[],
      launchFile?: FilesystemLocation,
    ): Effect.fn.Return<LaunchResult, ProcessLaunchError> {
      if (!canLaunch(appId)) return yield* rejectLaunch(appId, "forbidden");
      return launchResult(
        yield* withApp(
          appId,
          launchInstance({
            appId,
            runtime: sessionRuntime(),
            bounds,
            launchArgs,
            launchFile: launchFile
              ? { volume: launchFile.volume, path: launchFile.path }
              : undefined,
          }),
        ),
      );
    });

    const launchDaemon = Effect.fn(function* (
      appId: string,
      principal: ExecutionPrincipal,
      profile?: UserProfile,
    ): Effect.fn.Return<LaunchResult, ProcessLaunchError> {
      const manifest = packages.getAppForLaunch(appId);
      if (!manifest?.backend?.entry || manifest.frontend?.entry)
        return yield* rejectLaunch(appId, "not-daemon");
      return launchResult(
        yield* withApp(
          appId,
          launchInstance({
            appId,
            runtime: { owner: { kind: "system" }, principal, profile },
          }),
        ),
      );
    });

    const reserveInstance = Effect.fn(function* (
      appId: string,
      runtime: AppRuntime,
    ) {
      // Shutdown owns this scope and always closes it through closeInstance.
      const scope = yield* Scope.make();
      const record: InstanceRecord = { appId, runtime, scope, closing: false };
      instances.set(appId, record);
      yield* Scope.addFinalizer(
        scope,
        Effect.sync(() => {
          if (instances.get(appId) === record) instances.delete(appId);
        }),
      );
      return record;
    });

    function publishInstance(
      record: InstanceRecord,
      instance: AppInstance,
      backend?: PlatformUtilityProcess,
    ) {
      return Effect.suspend(
        (): Effect.Effect<
          AppInstance,
          ProcessLaunchRejected | BackendStartupFailed
        > => {
          const { appId } = record;
          if (_shuttingDown) return rejectLaunch(appId, "shutting-down");
          // Check native liveness and publish together, without an Effect yield.
          if (backend && backends.getBackend(appId) !== backend)
            return Effect.fail(
              new BackendStartupFailed({
                appId,
                reason: "exited",
                message: `Backend ${appId} exited during startup`,
              }),
            );
          record.instance = instance;
          record.backend = backend;
          launched.emit({ instance });
          return Effect.succeed(instance);
        },
      );
    }

    const launchInstance = Effect.fn(function* (
      request: LaunchRequest,
    ): Effect.fn.Return<AppInstance, ProcessLaunchError> {
      const { appId } = request;
      const manifest = packages.getAppForLaunch(appId);
      if (!manifest) return yield* rejectLaunch(appId, "not-installed");
      if (!manifest.frontend?.entry && !manifest.backend?.entry)
        return yield* rejectLaunch(appId, "invalid-entry");
      if (instances.has(appId))
        return yield* rejectLaunch(appId, "already-running");
      const installPath = packageCatalog.getPath(appId);
      if (!installPath) return yield* rejectLaunch(appId, "missing-path");
      if (_shuttingDown) return yield* rejectLaunch(appId, "shutting-down");

      return yield* Effect.acquireUseRelease(
        reserveInstance(appId, request.runtime),
        (record) =>
          acquireAppInstance(
            { ...request, manifest, installPath },
            { backends, views, contexts: runtimeContexts },
          ).pipe(
            Scope.provide(record.scope),
            Effect.flatMap(({ instance, backend }) =>
              publishInstance(record, instance, backend),
            ),
          ),
        (record, exit) =>
          Exit.isFailure(exit)
            ? closeInstance(record, exit).pipe(Effect.orDie)
            : Effect.void,
      ).pipe(
        Effect.tapError((error) =>
          Effect.sync(() => log.error(`Failed to launch app ${appId}:`, error)),
        ),
      );
    });

    const ensureAppRunning = Effect.fn(
      function* (
        appId: string,
      ): Effect.fn.Return<AppInstance, ProcessLaunchError> {
        const existing = getAppInstance(appId);
        if (existing) return existing;
        if (!canLaunch(appId)) return yield* rejectLaunch(appId, "forbidden");
        return yield* launchInstance({ appId, runtime: sessionRuntime() });
      },
      (work, appId) => withApp(appId, work),
    );

    const stopInstance = Effect.fn(function* (
      appId: string,
      caller?: CommandCallerContext,
    ): Effect.fn.Return<void, ProcessStopError> {
      const record = instances.get(appId);
      if (!record)
        return yield* Effect.fail(
          new ProcessNotRunning({
            appId,
            message: `App ${appId} is not running`,
          }),
        );
      const principal = caller?.principal;
      const target = record.runtime.principal;
      if (
        caller &&
        principal?.kind !== "system" &&
        !(
          principal?.kind === "user" &&
          (principal.profile.role === "vendor" ||
            (target.kind === "user" &&
              target.username === principal.profile.username))
        )
      )
        return yield* Effect.fail(
          new ProcessStopRejected({
            appId,
            message: `User cannot stop process ${appId}`,
          }),
        );
      yield* closeInstance(record).pipe(
        Effect.ensuring(Effect.sync(() => stopped.emit({ appId }))),
        Effect.uninterruptible,
        Effect.tapError((error) =>
          Effect.sync(() => log.error(`Failed to stop app ${appId}:`, error)),
        ),
      );
    });

    const stopApp = (appId: string, caller?: CommandCallerContext) =>
      withApp(appId, stopInstance(appId, caller));

    function prepareExit(appId: string): Effect.Effect<void, ProcessStopError> {
      const origin = instances.get(appId);
      if (!origin || origin.closing)
        throw new ProcessNotRunning({
          appId,
          message: `App ${appId} is not running`,
        });
      return withApp(
        appId,
        Effect.suspend(() =>
          instances.get(appId) === origin
            ? stopInstance(appId)
            : Effect.fail(
                new ProcessNotRunning({
                  appId,
                  message: `Originating process ${appId} is no longer running`,
                }),
              ),
        ),
      );
    }

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

    function handleAppExit(
      appId: string,
      backend: PlatformUtilityProcess,
      code: number,
    ): void {
      const record = instances.get(appId);
      if (!record || record.backend !== backend || record.closing) return;
      runLifecycle(
        withApp(
          appId,
          Effect.gen(function* () {
            if (instances.get(appId) !== record || record.closing) return;
            yield* closeInstance(record).pipe(
              Effect.ensuring(Effect.sync(() => exited.emit({ appId, code }))),
              Effect.uninterruptible,
            );
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
            }).pipe(logBackgroundFailure(`Failed to stop app ${appId}:`));
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
        yield* launchInstance({
          appId,
          bounds,
          runtime: {
            owner: instance.owner,
            principal: instance.principal,
            profile: runtime?.profile,
          },
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
      const failures: Cause.Cause<ProcessStopError>[] = [];
      for (const appId of running) {
        const exit = yield* Effect.exit(
          withApp(
            appId,
            Effect.suspend(() =>
              instances.has(appId) ? stopInstance(appId) : Effect.void,
            ),
          ),
        );
        if (Exit.isFailure(exit)) failures.push(exit.cause);
      }
      if (failures.length) {
        return yield* Effect.fail(
          new SessionProcessesStopFailed({
            sessionId,
            cause: new AggregateError(failures.map(Cause.squash)),
            message: "Failed to stop all session apps",
          }),
        );
      }
    }, Effect.uninterruptible);

    function isLoginApp(appId: string): boolean {
      return !!loginAppId && appId === loginAppId;
    }
    let stopHotReload: Effect.Effect<void> = Effect.void;
    yield* Effect.addFinalizer(() =>
      shutdown.pipe(
        logCleanupFailure("Failed to stop process lifecycle:"),
        Effect.ensuring(Effect.sync(dispose)),
      ),
    );
    stopHotReload = yield* watchHotReload({
      config,
      packages,
      isRunning: (appId) => instances.has(appId),
      reloadApp,
    }).pipe(
      logBackgroundFailure("Failed to watch hot reload state:"),
      Effect.map((stop) => stop ?? Effect.void),
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
      prepareExit,
      getRunningApps,
      getAppInstance,
      getMetrics,
      shutdown: () => shutdown,
      reloadApp,
      stopSessionApps,
    };
  }),
);
