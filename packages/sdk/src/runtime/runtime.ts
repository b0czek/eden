import * as fs from "node:fs";
import * as path from "node:path";
import type { EdenConfig } from "@edenapp/types";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import type { EdenLifecycleState } from "../api";
import { resolveBrandingName } from "../branding";
import { fromPromise } from "../effects/io";
import { createEffectRuntime } from "../effects/runtime";
import { log } from "../logging";
import type { EdenPlatform } from "../platform/ports";
import { seedDatabase } from "../seed";
import { createSettingsSdkController } from "../settings/controller-sdk";
import { createPanelRegistry } from "../settings/panel-registry";
import { composeRuntime, type RuntimeBundle } from "./composition";

export type { RuntimeServices } from "./composition";

export interface EdenRuntimePaths {
  appsDirectory: string;
  userDirectory: string;
  distPath: string;
  appPath: string;
}
export interface EdenRuntimeOptions {
  config?: EdenConfig;
  paths: EdenRuntimePaths;
  platform: EdenPlatform;
}
/** Lifecycle boundary; all started services belong to one acquired scope. */
export function createEdenRuntime(options: EdenRuntimeOptions) {
  const config: EdenConfig = {
    ...options.config,
    loginAppId: options.config?.loginAppId ?? "com.eden.login",
  };
  const paths = { ...options.paths };
  const platform = options.platform;
  fs.mkdirSync(paths.appsDirectory, { recursive: true });
  fs.mkdirSync(paths.userDirectory, { recursive: true });
  resolveBrandingName(config.branding);
  const effects = createEffectRuntime();
  const registrations = createPanelRegistry();
  const settings = createSettingsSdkController({ panels: registrations });
  let state: EdenLifecycleState = "created";
  let bundle: RuntimeBundle | undefined;
  let startup: Fiber.Fiber<void, unknown> | undefined;
  let disposal: Promise<void> | undefined;
  const launched = Deferred.makeUnsafe<Fiber.Fiber<void, unknown>, Error>();
  const readyPromise = Effect.runPromise(
    Deferred.await(launched).pipe(
      Effect.flatMap(Fiber.join),
      Effect.catchCause((cause) =>
        Effect.fail(
          Cause.hasInterruptsOnly(cause)
            ? new Error("Eden runtime startup aborted by shutdown")
            : Cause.squash(cause),
        ),
      ),
    ),
  ).catch(async (error) => {
    if (state === "starting") {
      state = "failed";
      log.error("Eden failed to start", error);
    }
    await release();
    throw error;
  });
  void readyPromise.catch(() => undefined);
  function requireBundle() {
    if (!bundle)
      throw new Error("Eden services are unavailable before startup completes");
    return bundle;
  }
  function operational() {
    if (!bundle || state !== "ready")
      throw new Error(
        "Eden is not ready. Await eden.whenReady() before using operational APIs.",
      );
    return bundle.controlPlane;
  }
  const initialize = Effect.fn(function* () {
    log.info("Eden starting...");
    yield* fromPromise(() =>
      seedDatabase(
        paths.appsDirectory,
        config.seedPath ?? path.join(paths.distPath, "eden-seed.json"),
        paths.userDirectory,
      ),
    );
    const desktop = yield* composeRuntime({
      config,
      paths,
      platform,
      effects,
      registrations,
    });
    bundle = desktop;
    yield* Effect.gen(function* () {
      const { services, appearance, associations } = desktop;
      yield* services.users.initialize();
      yield* services.packages.initialize();
      services.settingsPanels.synchronizeManifestPanels();
      yield* services.daemons.initialize();
      yield* services.sessions.initialize();
      yield* appearance.initialize();
      yield* associations.initialize();
      yield* desktop.foundation.open();
      state = "ready";
      log.info("Eden ready!");
    }).pipe(Effect.onError(() => desktop.shutdown()));
  });

  function start() {
    if (state === "starting" || state === "ready") return readyPromise;
    if (state !== "created")
      return Promise.reject(
        new Error(`Cannot start Eden runtime from ${state} state`),
      );
    state = "starting";
    const fiber = effects.forkScoped(initialize());
    startup = fiber;
    Deferred.doneUnsafe(launched, Effect.succeed(fiber));
    return readyPromise;
  }

  function release() {
    disposal ??= Effect.runPromise(
      Effect.gen(function* () {
        if (startup) {
          yield* Fiber.interrupt(startup);
          const exit = yield* Fiber.await(startup);
          // Failed or interrupted acquisition already shut down and closed its scope.
          if (Exit.isSuccess(exit) && bundle) yield* bundle.shutdown();
        }
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() =>
            log.error("Error during shutdown:", Cause.squash(cause)),
          ),
        ),
        Effect.ensuring(
          Effect.promise(() => effects.dispose()).pipe(
            Effect.catchCause((cause) =>
              Effect.sync(() =>
                log.error(
                  "Failed to dispose Eden service scope:",
                  Cause.squash(cause),
                ),
              ),
            ),
            Effect.ensuring(Effect.sync(registrations.dispose)),
          ),
        ),
      ),
    );
    return disposal;
  }

  function dispose() {
    if (state === "created")
      Deferred.doneUnsafe(
        launched,
        Effect.fail(new Error("Eden runtime disposed before startup")),
      );
    state = "stopping";
    bundle?.services.operations.closeAdmission();
    return release().then(() => {
      state = "stopped";
    });
  }
  function activate() {
    if (state === "ready" && bundle && !bundle.foundation.isOpen())
      void effects
        .run(bundle.foundation.open())
        .catch((error) =>
          log.error("Failed to activate foundation window:", error),
        );
  }
  return {
    effects,
    get services() {
      return requireBundle().services;
    },
    settings,
    start,
    dispose,
    activate,
    whenReady: () => readyPromise,
    get state() {
      return state;
    },
    get operations() {
      return requireBundle().operationsApi;
    },
    get volumes() {
      return operational().volumes;
    },
    get packages() {
      return operational().packages;
    },
    get daemons() {
      return operational().daemons;
    },
    get users() {
      return operational().users;
    },
    get sessions() {
      return operational().sessions;
    },
    get appearance() {
      return operational().appearance;
    },
    get associations() {
      return operational().associations;
    },
  };
}
export type EdenRuntime = ReturnType<typeof createEdenRuntime>;
