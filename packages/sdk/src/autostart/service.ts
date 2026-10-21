import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { listen } from "../events/scoped";
import { log } from "../logging/logger";
import { Sessions } from "../session/service";
import { EDEN_SETTINGS_APP_ID } from "../settings/constants";
import { Settings } from "../settings/service";
import {
  AutostartConfig,
  AutostartProcesses,
  DevelopmentAutostart,
} from "./ports";

export interface Autostart {
  onFoundationReady: () => void;
  shutdown: () => Effect.Effect<void>;
}

export const Autostart = Context.Service<"eden/Autostart", Autostart>(
  "eden/Autostart",
);

const AUTOSTART_PREFIX = "autostart.";
type Launch = "development" | "session" | "login";
export const AutostartLive = Layer.effect(
  Autostart,
  Effect.gen(function* () {
    const { development, loginAppId } = yield* AutostartConfig;
    const settings = yield* Settings;
    const sessions = yield* Sessions;
    const processes = yield* AutostartProcesses;
    const developmentApps = yield* DevelopmentAutostart;
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
        const currentUser = sessions.getCurrentUser();
        if (!currentUser) return;
        yield* Effect.catch(
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
          (error) =>
            Effect.sync(() =>
              log.warn("Failed to load autostart settings:", error),
            ),
        );
      });
    }

    function launchLoginApp() {
      return Effect.gen(function* () {
        if (
          disposed ||
          sessions.getCurrentUser() ||
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
          return task;
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
      Queue.offerUnsafe(
        pending,
        sessions.getCurrentUser() ? "session" : "login",
      );
    }

    const shutdown = Effect.uninterruptible(
      yield* Effect.cached(
        Effect.gen(function* () {
          disposed = true;
          ready = false;
          unsubscribe();
          yield* Queue.end(pending);
          yield* Fiber.join(worker);
        }),
      ),
    );

    yield* Effect.addFinalizer(() =>
      Effect.catchCause(shutdown, (cause) =>
        Effect.sync(() => {
          if (!Cause.hasInterruptsOnly(cause))
            log.error("Failed to stop startup launches:", Cause.squash(cause));
        }),
      ),
    );
    return { onFoundationReady, shutdown: () => shutdown };
  }),
);
