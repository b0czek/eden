import type {
  DaemonDefinition,
  DaemonStatus,
  ExecutionPrincipal,
  RuntimeAppManifest,
  UserProfile,
} from "@edenapp/types";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FiberMap from "effect/FiberMap";
import * as Layer from "effect/Layer";
import * as v from "valibot";
import type { Event } from "../../core/events/event";
import { scopedEvent } from "../../core/events/scoped";
import { EDEN_SETTINGS_APP_ID } from "../../core/settings/constants";
import { Settings } from "../../core/settings/service";
import { Users } from "../../core/user/service";
import { log } from "../../platform/logging/logger";
import { PackageCatalog } from "../packages/catalog";
import { Processes } from "../processes/service";
import {
  DaemonAppRequiredError,
  DaemonDefinitionReadError,
  DaemonDefinitionRemoveError,
  DaemonDefinitionWriteError,
  type DaemonLaunchError,
  DaemonPrincipalNotFoundError,
  DaemonPrincipalRequiredError,
  type DaemonStopError,
  type DaemonUpdateError,
  type DaemonValidationError,
} from "./errors";
import { daemonDefinitionSchema } from "./schemas";
import {
  createDaemonSupervisor,
  type DaemonState,
  type DaemonSupervisor,
} from "./supervision";

export interface Daemons {
  initialize: () => Effect.Effect<
    void,
    DaemonDefinitionReadError | DaemonLaunchError
  >;
  list: () => Effect.Effect<DaemonStatus[], DaemonDefinitionReadError>;
  updateDefinition: (
    definition: DaemonDefinition,
  ) => Effect.Effect<void, DaemonUpdateError>;
  setEnabled: (
    appId: string,
    enabled: boolean,
  ) => Effect.Effect<void, DaemonUpdateError | DaemonDefinitionReadError>;
  start: (appId: string) => Effect.Effect<void, DaemonLaunchError>;
  stop: (appId: string) => Effect.Effect<void, DaemonStopError>;
  restart: (
    appId: string,
  ) => Effect.Effect<void, DaemonLaunchError | DaemonStopError>;
  shutdown: () => Effect.Effect<void>;
  changed: Event<{ status: DaemonStatus }>;
  /** Capture the current launch attempt synchronously; return queued exit handling. */
  processExited: (
    appId: string,
    code: number,
  ) => Effect.Effect<void, DaemonLaunchError>;
  /** Capture the current launch attempt synchronously; return queued stop handling. */
  processStopped: (appId: string) => Effect.Effect<void, DaemonLaunchError>;
  /** Reserve adopted supervision synchronously so subsequent exits bind to it. */
  processLaunched: (
    appId: string,
    ownerKind: string,
  ) => Effect.Effect<void, DaemonLaunchError>;
  /** Revoke current supervision synchronously; return queued cancellation. */
  processReloading: (appId: string) => Effect.Effect<void>;
  /** Revoke current supervision synchronously; return queued persistent cleanup. */
  packageUninstalled: (
    appId: string,
  ) => Effect.Effect<void, DaemonDefinitionRemoveError>;
}

export const Daemons = Context.Service<"eden/Daemons", Daemons>("eden/Daemons");

interface DaemonRuntime {
  status: DaemonState;
  supervisor?: DaemonSupervisor<DaemonLaunchError>;
}

const KEY_PREFIX = "daemon.";
export const DaemonsLive = Layer.effect(
  Daemons,
  Effect.gen(function* () {
    const catalog = yield* PackageCatalog;
    const processes = yield* Processes;
    const settings = yield* Settings;
    const users = yield* Users;
    const clock = yield* Clock.Clock;
    const scope = yield* Effect.scope;
    const changed = yield* scopedEvent<{ status: DaemonStatus }>();
    const loaded = new Map<string, DaemonDefinition>();
    const runtimes = new Map<string, DaemonRuntime>();
    const fibers = yield* FiberMap.make<string, void, never>();
    let shuttingDown = false;
    const isCurrent = (appId: string, runtime: DaemonRuntime) =>
      runtimes.get(appId) === runtime && !shuttingDown;
    function replaceRuntime(appId: string): DaemonRuntime {
      const runtime = { status: getRuntime(appId) };
      runtimes.set(appId, runtime);
      return runtime;
    }
    const defaultDefinition = (appId: string): DaemonDefinition => ({
      appId,
      enabled: false,
      runAs: null,
      restart: "on-failure",
    });
    const daemonApps = () =>
      catalog
        .allApps()
        .filter((app) => !!app.backend?.entry && !app.frontend?.entry);
    const isDaemon = (appId: string) => {
      const app = catalog.getApp(appId);
      return !!app?.backend?.entry && !app.frontend?.entry;
    };
    const requireDaemon = (appId: string) =>
      Effect.suspend(() =>
        isDaemon(appId)
          ? Effect.void
          : Effect.fail(new DaemonAppRequiredError({ appId })),
      );
    const samePrincipal = (
      current: ExecutionPrincipal,
      configured: DaemonDefinition["runAs"],
    ) =>
      configured !== null &&
      current.kind === "user" &&
      current.username === configured.username;
    const getRuntime = (appId: string): DaemonState =>
      runtimes.get(appId)?.status ?? { state: "inactive", restartCount: 0 };
    const readPersisted = Effect.fn(function* () {
      const result = new Map<string, DaemonDefinition>();
      for (const key of yield* settings
        .list(EDEN_SETTINGS_APP_ID, true)
        .pipe(
          Effect.mapError((cause) => new DaemonDefinitionReadError({ cause })),
        )) {
        if (!key.startsWith(KEY_PREFIX)) continue;
        const value = yield* settings.get(EDEN_SETTINGS_APP_ID, key).pipe(
          Effect.mapError(
            (cause) =>
              new DaemonDefinitionReadError({
                appId: key.slice(KEY_PREFIX.length),
                cause,
              }),
          ),
        );
        if (!value) continue;
        try {
          const definition = v.parse(daemonDefinitionSchema, JSON.parse(value));
          result.set(definition.appId, definition);
        } catch (error) {
          log.warn(`Invalid daemon definition ${key}:`, error);
        }
      }
      return result;
    });
    function buildStatus(
      manifest: RuntimeAppManifest,
      definition = loaded.get(manifest.id) ?? defaultDefinition(manifest.id),
    ): DaemonStatus {
      const state = getRuntime(manifest.id);
      const instance = processes.getAppInstance(manifest.id);
      return {
        appId: manifest.id,
        name: manifest.name,
        definition,
        state: instance ? "active" : state.state,
        restartRequired:
          !!instance && !samePrincipal(instance.principal, definition.runAs),
        instanceId: instance?.instanceId,
        restartCount: state.restartCount,
        lastError: state.lastError,
        nextRestartAt: state.nextRestartAt,
      };
    }
    const list = Effect.fn(function* (): Effect.fn.Return<
      DaemonStatus[],
      DaemonDefinitionReadError
    > {
      const persisted = yield* readPersisted();
      return daemonApps().map((manifest) =>
        buildStatus(
          manifest,
          persisted.get(manifest.id) ??
            loaded.get(manifest.id) ??
            defaultDefinition(manifest.id),
        ),
      );
    });
    const emitStatus = (appId: string, runtime?: DaemonRuntime) =>
      Effect.sync(() => {
        if (runtime !== undefined && !isCurrent(appId, runtime)) return;
        const manifest = catalog.getApp(appId);
        if (manifest?.backend?.entry && !manifest.frontend?.entry)
          changed.emit({ status: buildStatus(manifest) });
      });
    const setRuntime = Effect.fn(function* (
      appId: string,
      state: DaemonState,
      runtime?: DaemonRuntime,
    ) {
      if (runtime !== undefined && !isCurrent(appId, runtime)) return;
      const owner = runtime ?? runtimes.get(appId) ?? replaceRuntime(appId);
      owner.status = state;
      yield* emitStatus(appId, owner);
    });
    const cancelSupervisor = (appId: string, runtime: DaemonRuntime) =>
      Effect.suspend(() =>
        isCurrent(appId, runtime)
          ? FiberMap.remove(fibers, appId)
          : Effect.void,
      );
    const markFailed = (
      appId: string,
      error: unknown,
      runtime?: DaemonRuntime,
    ) =>
      setRuntime(
        appId,
        {
          ...getRuntime(appId),
          state: "failed",
          lastError: error instanceof Error ? error.message : String(error),
        },
        runtime,
      );
    const validateDefinition = Effect.fn(function* (
      definition: DaemonDefinition,
      requirePrincipal = definition.enabled,
    ): Effect.fn.Return<UserProfile | undefined, DaemonValidationError> {
      yield* requireDaemon(definition.appId);
      if (!definition.runAs) {
        if (requirePrincipal)
          return yield* Effect.fail(
            new DaemonPrincipalRequiredError({ appId: definition.appId }),
          );
        return undefined;
      }
      const profile = yield* users.getUser(definition.runAs.username);
      if (!profile)
        return yield* Effect.fail(
          new DaemonPrincipalNotFoundError({
            appId: definition.appId,
            username: definition.runAs.username,
          }),
        );
      return profile;
    });
    const persist = (definition: DaemonDefinition) =>
      settings
        .set(
          EDEN_SETTINGS_APP_ID,
          `${KEY_PREFIX}${definition.appId}`,
          JSON.stringify(definition),
        )
        .pipe(
          Effect.mapError(
            (cause) =>
              new DaemonDefinitionWriteError({
                appId: definition.appId,
                cause,
              }),
          ),
        );
    const updateDefinition = Effect.fn(function* (
      definition: DaemonDefinition,
    ) {
      yield* validateDefinition(definition);
      yield* persist(definition);
      loaded.set(definition.appId, definition);
      yield* emitStatus(definition.appId);
    });
    const setEnabled = Effect.fn(function* (appId: string, enabled: boolean) {
      yield* requireDaemon(appId);
      const definition =
        (yield* readPersisted()).get(appId) ?? defaultDefinition(appId);
      const updated = { ...definition, enabled };
      yield* validateDefinition(updated);
      yield* persist(updated);
      loaded.set(appId, updated);
      yield* emitStatus(appId);
    });
    function prepareSupervisor(
      appId: string,
      runtime: DaemonRuntime,
      adopted = false,
      retryInitialFailure = false,
    ) {
      const supervisor = createDaemonSupervisor({
        clock,
        adopted,
        retryInitialFailure,
        isCurrent: () => isCurrent(appId, runtime),
        initialRestartCount: getRuntime(appId).restartCount,
        setState: (state) => setRuntime(appId, state, runtime),
        restartPolicy: () =>
          (loaded.get(appId) ?? defaultDefinition(appId)).restart,
        launch: Effect.gen(function* () {
          const definition = loaded.get(appId) ?? defaultDefinition(appId);
          const profile = yield* validateDefinition(definition, true);
          if (!profile)
            return yield* Effect.fail(
              new DaemonPrincipalRequiredError({ appId }),
            );
          if (!isCurrent(appId, runtime)) return yield* Effect.interrupt;
          yield* processes.launchDaemon(
            appId,
            { kind: "user", username: profile.username },
            profile,
          );
        }),
      });
      runtime.supervisor = supervisor;
      return supervisor;
    }
    const supervise = Effect.fn(function* (
      appId: string,
      runtime: DaemonRuntime,
      supervisor: DaemonSupervisor<DaemonLaunchError>,
    ) {
      // The enclosing scope also owns replaced fibers until their finalizers finish.
      const fiber = yield* Effect.forkIn(
        supervisor.run.pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.failCause(cause).pipe(Effect.orDie)
              : Effect.sync(() =>
                  log.error(
                    `Daemon supervision failed for ${appId}:`,
                    Cause.squash(cause),
                  ),
                ),
          ),
        ),
        scope,
      );
      if (isCurrent(appId, runtime)) FiberMap.setUnsafe(fibers, appId, fiber);
      else yield* Fiber.interrupt(fiber);
      return supervisor.ready;
    });
    const startAttempt = Effect.fn(function* (
      appId: string,
      retryOnFailure: boolean,
    ): Effect.fn.Return<void, DaemonLaunchError> {
      yield* requireDaemon(appId);
      if (processes.getAppInstance(appId) || shuttingDown) return;
      yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const runtime = replaceRuntime(appId);
          yield* cancelSupervisor(appId, runtime);
          if (!isCurrent(appId, runtime)) return;
          const ready = yield* supervise(
            appId,
            runtime,
            prepareSupervisor(appId, runtime, false, retryOnFailure),
          );
          yield* restore(ready).pipe(
            Effect.onInterrupt(() => cancelSupervisor(appId, runtime)),
          );
        }),
      );
    });
    const start = (appId: string) => startAttempt(appId, false);
    const stop = Effect.fn(function* (appId: string) {
      yield* requireDaemon(appId);
      const runtime = replaceRuntime(appId);
      yield* cancelSupervisor(appId, runtime);
      if (!isCurrent(appId, runtime)) return;
      if (!processes.getAppInstance(appId)) {
        yield* setRuntime(
          appId,
          { state: "inactive", restartCount: 0 },
          runtime,
        );
        return;
      }
      yield* setRuntime(
        appId,
        { ...getRuntime(appId), state: "stopping" },
        runtime,
      );
      if (!isCurrent(appId, runtime)) return;
      yield* processes.stopApp(appId).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            if (isCurrent(appId, runtime)) {
              yield* markFailed(appId, error, runtime);
            }
            return yield* Effect.fail(error);
          }),
        ),
      );
      if (!isCurrent(appId, runtime)) return;
      yield* setRuntime(appId, { state: "inactive", restartCount: 0 }, runtime);
    });
    const restart = Effect.fn(function* (appId: string) {
      if (processes.getAppInstance(appId)) yield* stop(appId);
      yield* start(appId);
    });
    function processTerminated(appId: string, code: number) {
      return runtimes.get(appId)?.supervisor?.terminated(code) ?? Effect.void;
    }
    const processExited = (appId: string, code: number) =>
      processTerminated(appId, code);
    const processStopped = (appId: string) => processTerminated(appId, 1);
    function processLaunched(appId: string, ownerKind: string) {
      if (
        !isDaemon(appId) ||
        ownerKind !== "system" ||
        getRuntime(appId).state === "starting" ||
        shuttingDown
      )
        return Effect.void;
      const runtime = replaceRuntime(appId);
      const supervisor = prepareSupervisor(appId, runtime, true);
      return Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          yield* cancelSupervisor(appId, runtime);
          if (!isCurrent(appId, runtime)) return;
          const ready = yield* supervise(appId, runtime, supervisor);
          yield* restore(ready);
        }),
      );
    }
    function processReloading(appId: string) {
      if (!isDaemon(appId) || shuttingDown) return Effect.void;
      const runtime = replaceRuntime(appId);
      return cancelSupervisor(appId, runtime);
    }
    function packageUninstalled(appId: string) {
      if (!loaded.has(appId) && !runtimes.has(appId) && !isDaemon(appId))
        return Effect.void;
      const runtime = replaceRuntime(appId);
      return Effect.gen(function* () {
        yield* cancelSupervisor(appId, runtime);
        if (!isCurrent(appId, runtime)) return;
        loaded.delete(appId);
        runtimes.delete(appId);
        yield* settings
          .delete(EDEN_SETTINGS_APP_ID, `${KEY_PREFIX}${appId}`)
          .pipe(
            Effect.mapError(
              (cause) => new DaemonDefinitionRemoveError({ appId, cause }),
            ),
          );
      });
    }
    const shutdown = Effect.uninterruptible(
      yield* Effect.cached(
        Effect.gen(function* () {
          shuttingDown = true;
          yield* FiberMap.clear(fibers);
        }),
      ),
    );
    const initialize = Effect.fn(function* () {
      const persisted = yield* readPersisted();
      for (const app of daemonApps()) {
        const definition = persisted.get(app.id) ?? defaultDefinition(app.id);
        yield* validateDefinition(definition).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              loaded.set(app.id, definition);
            }),
          ),
          Effect.catch((error) => Effect.asVoid(markFailed(app.id, error))),
        );
      }
      for (const definition of loaded.values())
        if (definition.enabled) yield* startAttempt(definition.appId, true);
    });
    yield* Effect.addFinalizer(() => shutdown);
    return {
      initialize,
      list,
      updateDefinition,
      setEnabled,
      start,
      stop,
      restart,
      shutdown: () => shutdown,
      changed,
      processExited,
      processStopped,
      processLaunched,
      processReloading,
      packageUninstalled,
    };
  }),
);
