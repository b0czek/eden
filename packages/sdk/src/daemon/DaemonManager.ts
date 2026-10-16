import type {
  DaemonDefinition,
  DaemonRuntimeState,
  DaemonStatus,
  ExecutionPrincipal,
  UserProfile,
} from "@edenapp/types";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as v from "valibot";
import { scopedEvent } from "../events/scoped";
import { log } from "../logging";
import type { PackageCatalog } from "../package-manager/PackageCatalog";
import type { ProcessManager } from "../process-manager/ProcessManager";
import { EDEN_SETTINGS_APP_ID } from "../settings/constants";
import type { Settings } from "../settings/service";
import type { UserManager } from "../user/UserManager";
import { daemonDefinitionSchema } from "./schemas";

interface RuntimeState {
  state: DaemonRuntimeState;
  restartCount: number;
  lastError?: string;
  nextRestartAt?: number;
  timer?: Fiber.Fiber<void, Error>;
  stableTimer?: Fiber.Fiber<void, Error>;
}
const KEY_PREFIX = "daemon.";
export const createDaemonManager = Effect.fn(function* ({
  catalog,
  processes,
  settings,
  users,
}: {
  catalog: Pick<PackageCatalog, "allApps" | "getApp">;
  processes: Pick<
    ProcessManager,
    "getAppInstance" | "launchDaemon" | "stopApp"
  >;
  settings: Pick<Settings, "list" | "get" | "set" | "delete">;
  users: Pick<UserManager, "getUser">;
}) {
  const scope = yield* Effect.scope;
  const changed = yield* scopedEvent<{ status: DaemonStatus }>();
  const loaded = new Map<string, DaemonDefinition>();
  const states = new Map<string, RuntimeState>();
  const supervised = new Map<string, number>();
  const intentionalStops = new Map<string, number>();
  const generations = new Map<string, number>();
  const generationOf = (appId: string) => generations.get(appId) ?? 0;
  const isCurrent = (appId: string, generation: number) =>
    generationOf(appId) === generation;
  function nextGeneration(appId: string): number {
    const generation = generationOf(appId) + 1;
    generations.set(appId, generation);
    supervised.delete(appId);
    intentionalStops.delete(appId);
    return generation;
  }
  let shuttingDown = false;
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
    Effect.try({
      try: () => {
        if (!isDaemon(appId))
          throw new Error(`App ${appId} is not a backend-only daemon`);
      },
      catch: (error) => error as Error,
    });
  const samePrincipal = (
    current: ExecutionPrincipal,
    configured: DaemonDefinition["runAs"],
  ) =>
    configured !== null &&
    current.kind === "user" &&
    current.username === configured.username;
  const getRuntime = (appId: string): RuntimeState =>
    states.get(appId) ?? { state: "inactive", restartCount: 0 };
  const readPersisted = Effect.fn(function* () {
    const result = new Map<string, DaemonDefinition>();
    for (const key of yield* settings.list(EDEN_SETTINGS_APP_ID, true)) {
      if (!key.startsWith(KEY_PREFIX)) continue;
      const value = yield* settings.get(EDEN_SETTINGS_APP_ID, key);
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
  const list = Effect.fn(function* (): Effect.fn.Return<DaemonStatus[], Error> {
    const persisted = yield* readPersisted();
    return daemonApps().map((manifest) => {
      const definition =
        persisted.get(manifest.id) ??
        loaded.get(manifest.id) ??
        defaultDefinition(manifest.id);
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
    });
  });
  const emitStatus = Effect.fn(function* (appId: string, generation?: number) {
    if (generation !== undefined && !isCurrent(appId, generation)) return;
    const status = (yield* list()).find((entry) => entry.appId === appId);
    if (status && (generation === undefined || isCurrent(appId, generation)))
      changed.emit({ status });
  });
  const setRuntime = Effect.fn(function* (
    appId: string,
    state: RuntimeState,
    generation?: number,
  ) {
    if (generation !== undefined && !isCurrent(appId, generation)) return state;
    states.set(appId, state);
    yield* emitStatus(appId, generation);
    return state;
  });
  const clearTimers = Effect.fn(function* (appId: string, generation?: number) {
    if (generation !== undefined && !isCurrent(appId, generation)) return;
    const state = states.get(appId);
    if (!state) return;
    const timer = state.timer;
    const stableTimer = state.stableTimer;
    state.timer = undefined;
    state.stableTimer = undefined;
    if (timer) yield* Fiber.interrupt(timer);
    if (stableTimer) yield* Fiber.interrupt(stableTimer);
  });
  const markFailed = (appId: string, error: unknown, generation?: number) =>
    setRuntime(
      appId,
      {
        ...getRuntime(appId),
        state: "failed",
        lastError: error instanceof Error ? error.message : String(error),
      },
      generation,
    );
  const markActive = Effect.fn(function* (appId: string, generation: number) {
    if (!isCurrent(appId, generation) || shuttingDown) return;
    yield* clearTimers(appId, generation);
    if (!isCurrent(appId, generation)) return;
    const state = yield* setRuntime(
      appId,
      {
        ...getRuntime(appId),
        state: "active",
        lastError: undefined,
        nextRestartAt: undefined,
      },
      generation,
    );
    if (!isCurrent(appId, generation) || states.get(appId) !== state) return;
    const timer = yield* Effect.forkIn(
      Effect.sleep(60_000).pipe(
        Effect.flatMap(() => {
          if (
            !isCurrent(appId, generation) ||
            states.get(appId) !== state ||
            shuttingDown
          )
            return Effect.void;
          state.stableTimer = undefined;
          return Effect.asVoid(
            setRuntime(appId, { state: "active", restartCount: 0 }, generation),
          );
        }),
      ),
      scope,
    );
    if (isCurrent(appId, generation) && states.get(appId) === state)
      state.stableTimer = timer;
    else yield* Fiber.interrupt(timer);
  });
  const validateDefinition = Effect.fn(function* (
    definition: DaemonDefinition,
    requirePrincipal = definition.enabled,
  ): Effect.fn.Return<UserProfile | undefined, Error> {
    yield* requireDaemon(definition.appId);
    if (!definition.runAs) {
      if (requirePrincipal)
        return yield* Effect.fail(
          new Error(`Daemon ${definition.appId} requires a runAs account`),
        );
      return undefined;
    }
    const profile = yield* users.getUser(definition.runAs.username);
    if (!profile)
      return yield* Effect.fail(
        new Error(`Daemon user ${definition.runAs.username} does not exist`),
      );
    return profile;
  });
  const persist = (definition: DaemonDefinition) =>
    settings.set(
      EDEN_SETTINGS_APP_ID,
      `${KEY_PREFIX}${definition.appId}`,
      JSON.stringify(definition),
    );
  const updateDefinition = Effect.fn(function* (definition: DaemonDefinition) {
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
    const previous = loaded.get(appId);
    if (previous) loaded.set(appId, { ...previous, enabled });
    yield* emitStatus(appId);
  });
  const startAttempt = Effect.fn(function* (
    appId: string,
    retryOnFailure: boolean,
    expectedGeneration?: number,
  ): Effect.fn.Return<void, Error> {
    if (
      expectedGeneration !== undefined &&
      !isCurrent(appId, expectedGeneration)
    )
      return;
    yield* requireDaemon(appId);
    if (processes.getAppInstance(appId) || shuttingDown) return;
    const generation = nextGeneration(appId);
    yield* clearTimers(appId, generation);
    yield* Effect.gen(function* () {
      const definition = loaded.get(appId) ?? defaultDefinition(appId);
      const profile = yield* validateDefinition(definition, true);
      if (!profile)
        return yield* Effect.fail(
          new Error(`Daemon ${appId} requires a runAs account`),
        );
      if (!isCurrent(appId, generation) || shuttingDown) return;
      yield* setRuntime(
        appId,
        {
          ...getRuntime(appId),
          state: "starting",
          lastError: undefined,
          nextRestartAt: undefined,
        },
        generation,
      );
      if (!isCurrent(appId, generation) || shuttingDown) return;
      supervised.set(appId, generation);
      yield* processes.launchDaemon(
        appId,
        { kind: "user", username: profile.username },
        profile,
      );
      if (isCurrent(appId, generation)) yield* markActive(appId, generation);
    }).pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          if (!isCurrent(appId, generation)) return;
          supervised.delete(appId);
          yield* markFailed(appId, error, generation);
          if (retryOnFailure) yield* handleExit(appId, 1, generation);
          else return yield* Effect.fail(error);
        }),
      ),
    );
  });
  const start = (appId: string) => startAttempt(appId, false);
  const stop = Effect.fn(function* (appId: string) {
    yield* requireDaemon(appId);
    const wasSupervised = supervised.get(appId) === generationOf(appId);
    const generation = nextGeneration(appId);
    if (wasSupervised) intentionalStops.set(appId, generation);
    yield* clearTimers(appId, generation);
    if (!isCurrent(appId, generation)) return;
    if (!processes.getAppInstance(appId)) {
      intentionalStops.delete(appId);
      yield* setRuntime(
        appId,
        { state: "inactive", restartCount: 0 },
        generation,
      );
      return;
    }
    yield* setRuntime(
      appId,
      { ...getRuntime(appId), state: "stopping" },
      generation,
    );
    if (!isCurrent(appId, generation)) return;
    yield* processes.stopApp(appId).pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          if (isCurrent(appId, generation)) {
            intentionalStops.delete(appId);
            yield* markFailed(appId, error, generation);
          }
          return yield* Effect.fail(error);
        }),
      ),
    );
    if (!isCurrent(appId, generation)) return;
    intentionalStops.delete(appId);
    supervised.delete(appId);
    yield* setRuntime(
      appId,
      { state: "inactive", restartCount: 0 },
      generation,
    );
  });
  const restart = Effect.fn(function* (appId: string) {
    if (processes.getAppInstance(appId)) yield* stop(appId);
    yield* start(appId);
  });
  const handleExit = Effect.fn(function* (
    appId: string,
    code: number,
    generation: number,
  ): Effect.fn.Return<void, Error> {
    if (!isCurrent(appId, generation) || shuttingDown) return;
    yield* clearTimers(appId, generation);
    if (!isCurrent(appId, generation) || shuttingDown) return;
    const definition = loaded.get(appId) ?? defaultDefinition(appId);
    const shouldRestart =
      definition.restart === "always" ||
      (definition.restart === "on-failure" && code !== 0);
    if (!shouldRestart) {
      yield* setRuntime(
        appId,
        {
          ...getRuntime(appId),
          state: code === 0 ? "inactive" : "failed",
          lastError: code === 0 ? undefined : `Exited with code ${code}`,
        },
        generation,
      );
      return;
    }
    const count = getRuntime(appId).restartCount + 1;
    const delay = Math.min(2 ** (count - 1), 30) * 1000;
    const state = yield* setRuntime(
      appId,
      {
        state: "backoff",
        restartCount: count,
        lastError: `Exited with code ${code}`,
        nextRestartAt: Date.now() + delay,
      },
      generation,
    );
    if (!isCurrent(appId, generation) || states.get(appId) !== state) return;
    const timer = yield* Effect.forkIn(
      Effect.sleep(delay).pipe(
        Effect.flatMap(() => {
          if (
            !isCurrent(appId, generation) ||
            states.get(appId) !== state ||
            shuttingDown
          )
            return Effect.void;
          state.timer = undefined;
          return startAttempt(appId, true, generation);
        }),
      ),
      scope,
    );
    if (isCurrent(appId, generation) && states.get(appId) === state)
      state.timer = timer;
    else yield* Fiber.interrupt(timer);
  });
  // Notification preparation captures ownership before a queued consumer can observe a replacement process.
  function processTerminated(appId: string, code: number) {
    const generation = generationOf(appId);
    const intentional = intentionalStops.get(appId) === generation;
    const wasSupervised = supervised.get(appId) === generation;
    if (intentional) intentionalStops.delete(appId);
    if (wasSupervised) supervised.delete(appId);
    return Effect.suspend(() => {
      if (!isCurrent(appId, generation) || shuttingDown) return Effect.void;
      if (intentional)
        return Effect.asVoid(
          setRuntime(appId, { state: "inactive", restartCount: 0 }, generation),
        );
      return wasSupervised ? handleExit(appId, code, generation) : Effect.void;
    });
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
    const generation = nextGeneration(appId);
    supervised.set(appId, generation);
    return markActive(appId, generation);
  }
  function processReloading(appId: string) {
    if (!isDaemon(appId) || shuttingDown) return Effect.void;
    const generation = nextGeneration(appId);
    intentionalStops.set(appId, generation);
    return clearTimers(appId, generation);
  }
  function packageUninstalled(appId: string) {
    if (
      !loaded.has(appId) &&
      !states.has(appId) &&
      !generations.has(appId) &&
      !isDaemon(appId)
    )
      return Effect.void;
    const generation = nextGeneration(appId);
    return Effect.gen(function* () {
      yield* clearTimers(appId, generation);
      if (!isCurrent(appId, generation)) return;
      loaded.delete(appId);
      states.delete(appId);
      yield* settings.delete(EDEN_SETTINGS_APP_ID, `${KEY_PREFIX}${appId}`);
    });
  }
  const shutdown = Effect.fn(function* () {
    shuttingDown = true;
    for (const appId of new Set([...states.keys(), ...generations.keys()])) {
      nextGeneration(appId);
      yield* clearTimers(appId);
    }
  });
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
  yield* Effect.addFinalizer(() => shutdown().pipe(Effect.orDie));
  return {
    initialize,
    list,
    updateDefinition,
    setEnabled,
    start,
    stop,
    restart,
    shutdown,
    changed,
    processExited,
    processStopped,
    processLaunched,
    processReloading,
    packageUninstalled,
  };
});
export type DaemonManager = Effect.Success<
  ReturnType<typeof createDaemonManager>
>;
