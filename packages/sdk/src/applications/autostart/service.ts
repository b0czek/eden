import type { OperationHandle } from "@edenapp/types";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import { listen } from "../../core/events/scoped";
import type { CommandCallerContext } from "../../core/execution/context";
import { OperationAdmissionClosed } from "../../core/operations/errors";
import { Operations } from "../../core/operations/service";
import { operationTask } from "../../core/operations/task";
import { EDEN_SETTINGS_APP_ID } from "../../core/settings/constants";
import { Settings } from "../../core/settings/service";
import { SessionContext } from "../../desktop/session/context";
import { Sessions } from "../../desktop/session/service";
import { log } from "../../platform/logging/logger";
import { PackageCatalog } from "../packages/catalog";
import { Processes } from "../processes/service";
import { AutostartConfig, DevelopmentAutostart } from "./ports";

export interface Autostart {
  onFoundationReady: () => void;
  shutdown: () => Effect.Effect<void>;
}

export const Autostart = Context.Service<"eden/Autostart", Autostart>(
  "eden/Autostart",
);

const AUTOSTART_PREFIX = "autostart.";
type Launch = "development" | "session" | "login";
interface LaunchOperation {
  handle: OperationHandle;
  context: CommandCallerContext;
}
export const AutostartLive = Layer.effect(
  Autostart,
  Effect.gen(function* () {
    const { development, loginAppId } = yield* AutostartConfig;
    const settings = yield* Settings;
    const sessions = yield* Sessions;
    const session = yield* SessionContext;
    const operations = yield* Operations;
    const processes = yield* Processes;
    const catalog = yield* PackageCatalog;
    const developmentApps = yield* DevelopmentAutostart;
    let ready = false;
    let disposed = false;
    const pending = new Set<LaunchOperation>();
    const order = Semaphore.makeUnsafe(1);

    function launchDevelopmentApps() {
      return Effect.gen(function* () {
        const apps = yield* developmentApps.apps;
        for (const app of apps.filter((entry) => entry.launchOnStart)) {
          if (disposed) return;
          if (processes.getAppInstance(app.id)) continue;
          yield* Effect.match(processes.launchApp(app.id), {
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
        yield* Effect.catch(
          Effect.gen(function* () {
            const entries = yield* loadAutostartSettings();
            for (const [appId, enabled] of entries) {
              if (!enabled) continue;
              if (disposed) return;
              const manifest = catalog.getApp(appId);
              if (manifest && !manifest.frontend?.entry) continue;
              if (processes.getAppInstance(appId)) continue;
              yield* Effect.match(processes.launchApp(appId), {
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
          processes.getAppInstance(loginAppId)
        )
          return;
        yield* Effect.match(processes.launchApp(loginAppId), {
          onFailure: (error) =>
            log.error(`Failed to launch login app ${loginAppId}:`, error),
          onSuccess: () => log.info(`Login app launched: ${loginAppId}`),
        });
      });
    }

    function enqueue(launch: Launch) {
      if (launch === "login" && !loginAppId) return;
      const user = session.getCurrentUser();
      const context: CommandCallerContext = {
        sessionId: session.getSessionId(),
        principal: user ? { kind: "user", profile: user } : { kind: "system" },
      };
      const work = order
        .withPermit(
          Effect.suspend(() => {
            if (disposed) return Effect.void;
            return launch === "development"
              ? launchDevelopmentApps()
              : launch === "session"
                ? launchSessionApps()
                : launchLoginApp();
          }),
        )
        .pipe(
          Effect.onError((cause) =>
            Effect.sync(() => {
              if (!Cause.hasInterruptsOnly(cause))
                log.error("Startup operation failed:", Cause.squash(cause));
            }),
          ),
        );
      let entry: LaunchOperation | undefined;
      try {
        const handle = operations.submit(
          `autostart/${launch}`,
          {},
          context,
          () =>
            operationTask(() => work, {
              cancellable: true,
              release: () => {
                if (entry) pending.delete(entry);
              },
            }),
        );
        entry = { handle, context };
        pending.add(entry);
      } catch (error) {
        if (!(error instanceof OperationAdmissionClosed))
          log.error("Failed to schedule startup operation:", error);
      }
    }

    const unsubscribe = yield* listen(
      sessions.changed,
      ({ currentUser, previousUsername }) => {
        if (
          disposed ||
          !ready ||
          (currentUser?.username ?? null) === previousUsername
        )
          return;
        enqueue(currentUser ? "session" : "login");
      },
    );

    function onFoundationReady() {
      if (ready || disposed) return;
      ready = true;
      if (development) enqueue("development");
      enqueue(sessions.getCurrentUser() ? "session" : "login");
    }

    const shutdown = Effect.uninterruptible(
      yield* Effect.cached(
        Effect.gen(function* () {
          disposed = true;
          ready = false;
          unsubscribe();
          const active = [...pending];
          for (const { handle, context } of active)
            operations.cancel(handle, context);
          yield* Effect.forEach(
            active,
            ({ handle, context }) => operations.settle(handle, context),
            { discard: true },
          );
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
