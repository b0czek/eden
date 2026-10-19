import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { listen } from "../events/scoped";
import { log } from "../logging";
import { EDEN_SETTINGS_APP_ID } from "../settings/constants";
import type { AutostartDependencies } from "./ports";

const AUTOSTART_PREFIX = "autostart.";
type Launch = "development" | "session" | "login";

/** Serialize startup and committed-session launches within one owned lifetime. */
export function createAutostart({
  development,
  loginAppId,
  settings,
  sessions,
  processes,
  developmentApps,
}: AutostartDependencies) {
  return Effect.gen(function* () {
    let ready = false;
    let disposed = false;
    const pending = yield* Queue.unbounded<Launch, Cause.Done>();

    function launchDevelopmentApps() {
      return Effect.gen(function* () {
        const apps = yield* developmentApps.apps;
        for (const app of apps.filter((entry) => entry.launchOnStart)) {
          if (disposed) return;
          if (processes.isRunning(app.id)) continue;
          yield* Effect.match(processes.launch(app.id), {
            onFailure: (error) =>
              log.error(`Failed to launch development app ${app.id}:`, error),
            onSuccess: () => log.info(`Development app launched: ${app.id}`),
          });
        }
      });
    }

    function loadAutostartSettings() {
      return Effect.gen(function* () {
        const entries = new Map<string, boolean>();
        // Autostart is a system concern, independent of settings UI grants.
        const keys = yield* settings.list(EDEN_SETTINGS_APP_ID, true);
        for (const key of keys) {
          if (!key.startsWith(AUTOSTART_PREFIX)) continue;
          const appId = key.slice(AUTOSTART_PREFIX.length);
          const value = yield* settings.get(EDEN_SETTINGS_APP_ID, key);
          entries.set(appId, value === "true");
        }
        return entries;
      });
    }

    function launchSessionApps() {
      return Effect.gen(function* () {
        // Capture the user when this queued job starts, as session transitions may queue.
        const currentUser = sessions.currentUser();
        if (!currentUser) return;
        yield* Effect.catchCause(
          Effect.gen(function* () {
            const entries = yield* loadAutostartSettings();
            for (const [appId, enabled] of entries) {
              if (!enabled) continue;
              if (disposed) return;
              const manifest = processes.installedManifest(appId);
              if (manifest && !manifest.frontend?.entry) continue;
              if (processes.isRunning(appId)) continue;
              yield* Effect.match(processes.launch(appId, currentUser), {
                onFailure: (error) =>
                  log.error(`Failed to launch autostart app ${appId}:`, error),
                onSuccess: () => log.info(`Autostart app launched: ${appId}`),
              });
            }
          }),
          (cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.failCause(cause)
              : Effect.sync(() =>
                  log.warn(
                    "Failed to load autostart settings:",
                    Cause.squash(cause),
                  ),
                ),
        );
      });
    }

    function launchLoginApp() {
      return Effect.gen(function* () {
        if (
          disposed ||
          sessions.currentUser() ||
          !loginAppId ||
          processes.isRunning(loginAppId)
        )
          return;
        yield* Effect.match(processes.launch(loginAppId), {
          onFailure: (error) =>
            log.error(`Failed to launch login app ${loginAppId}:`, error),
          onSuccess: () => log.info(`Login app launched: ${loginAppId}`),
        });
      });
    }

    const worker = yield* Effect.forkScoped(
      Stream.runForEach(Stream.fromQueue(pending), (launch) =>
        Effect.suspend(() => {
          if (disposed) return Effect.void;
          const task =
            launch === "development"
              ? launchDevelopmentApps()
              : launch === "session"
                ? launchSessionApps()
                : launchLoginApp();
          return Effect.catchCause(task, (cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.failCause(cause)
              : Effect.sync(() =>
                  log.error(
                    "Failed to launch startup apps:",
                    Cause.squash(cause),
                  ),
                ),
          );
        }),
      ),
    );

    const unsubscribe = yield* listen(
      sessions.changed,
      ({ currentUser, previousUsername }) => {
        if (
          disposed ||
          !ready ||
          (currentUser?.username ?? null) === previousUsername
        )
          return;
        Queue.offerUnsafe(pending, currentUser ? "session" : "login");
      },
    );

    function onFoundationReady() {
      if (ready || disposed) return;
      ready = true;
      if (development) Queue.offerUnsafe(pending, "development");
      Queue.offerUnsafe(pending, sessions.currentUser() ? "session" : "login");
    }

    function shutdown() {
      return Effect.gen(function* () {
        if (!disposed) {
          disposed = true;
          ready = false;
          unsubscribe();
          yield* Queue.end(pending);
        }
        yield* Fiber.join(worker);
      }).pipe(Effect.uninterruptible);
    }

    yield* Effect.addFinalizer(() =>
      Effect.catchCause(shutdown(), (cause) =>
        Effect.sync(() => {
          if (!Cause.hasInterruptsOnly(cause))
            log.error("Failed to stop startup launches:", Cause.squash(cause));
        }),
      ),
    );
    return { onFoundationReady, shutdown };
  });
}

export type Autostart = Effect.Success<ReturnType<typeof createAutostart>>;
