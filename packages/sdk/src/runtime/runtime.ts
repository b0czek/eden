import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import type { EdenConfig } from "../api/config";
import type { EdenLifecycleState } from "../api/control-plane";
import { asError } from "../core/effects/io";
import { createSettingsSdkController } from "../core/settings/controller-sdk";
import { createPanelRegistry } from "../core/settings/panels/registry";
import { resolveBrandingName } from "../desktop/branding/service";
import { syncIo } from "../platform/filesystem/native-sync";
import { log } from "../platform/logging/logger";
import { createDesktopLayer } from "./composition";
import { Desktop } from "./desktop";
import type { EdenRuntimeOptions } from "./environment";

export type { EdenRuntimeOptions, EdenRuntimePaths } from "./environment";
export type { RuntimeServices } from "./services";

const ReadyDesktop = Context.Service<"eden/ReadyDesktop", Desktop>(
  "eden/ReadyDesktop",
);

/** Lifecycle boundary; all started services belong to one acquired scope. */
export function createEdenRuntime(options: EdenRuntimeOptions) {
  const config: EdenConfig = {
    ...options.config,
    loginAppId: options.config?.loginAppId ?? "com.eden.login",
  };
  const paths = { ...options.paths };
  const platform = options.platform;
  syncIo.mkdir(paths.appsDirectory, { recursive: true });
  syncIo.mkdir(paths.userDirectory, { recursive: true });
  resolveBrandingName(config.branding);
  const registrations = createPanelRegistry();
  const settings = createSettingsSdkController({ panels: registrations });
  let state: EdenLifecycleState = "created";
  let bundle: Desktop | undefined;
  let startup: Fiber.Fiber<void, unknown> | undefined;
  let disposal: Promise<void> | undefined;
  const launched = Deferred.makeUnsafe<Fiber.Fiber<void, unknown>, Error>();
  // @eden-effect-next-line domain-interpreter -- Runtime boundary exposes startup readiness as a host Promise and joins its retained fiber.
  const readyPromise = Effect.runPromise(
    Deferred.await(launched).pipe(
      Effect.flatMap(Fiber.join),
      Effect.catchCause((cause) =>
        Effect.gen(function* () {
          const error = Cause.hasInterruptsOnly(cause)
            ? new Error("Eden runtime startup aborted by shutdown")
            : Cause.squash(cause);
          if (state === "starting") {
            state = "failed";
            log.error("Eden failed to start", error);
          }
          yield* Effect.promise(release);
          return yield* Effect.fail(error);
        }),
      ),
    ),
  );
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
    const desktop = yield* Desktop;
    bundle = desktop;
    yield* desktop.initialize().pipe(Effect.onError(() => desktop.shutdown()));
    state = "ready";
    log.info("Eden ready!");
    return desktop;
  });
  // @eden-effect-next-line domain-interpreter -- The composition root owns the desktop Layer and every host execution.
  const managed = ManagedRuntime.make(
    Layer.effect(ReadyDesktop, initialize()).pipe(
      Layer.provide(
        createDesktopLayer({ config, paths, platform, registrations }),
      ),
    ),
  );
  const effects = {
    run<A, E>(work: Effect.Effect<A, E>): Promise<A> {
      if (state === "created")
        return Promise.reject(new Error("Eden is not ready"));
      return managed.runPromise(work).catch((error) => {
        throw asError(error);
      });
    },
    fork<A, E>(work: Effect.Effect<A, E>) {
      if (state === "created") throw new Error("Eden is not ready");
      return managed.runFork(work);
    },
  };

  function start() {
    if (state === "starting" || state === "ready") return readyPromise;
    if (state !== "created")
      return Promise.reject(
        new Error(`Cannot start Eden runtime from ${state} state`),
      );
    state = "starting";
    const fiber = managed.runFork(Effect.asVoid(ReadyDesktop));
    startup = fiber;
    Deferred.doneUnsafe(launched, Effect.succeed(fiber));
    return readyPromise;
  }

  function release() {
    // @eden-effect-next-line domain-interpreter -- Runtime boundary exposes disposal as an idempotent Promise and awaits managed shutdown.
    disposal ??= Effect.runPromise(
      Effect.gen(function* () {
        if (startup) yield* Fiber.interrupt(startup);
        if (bundle) yield* bundle.shutdown();
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() =>
            log.error("Error during shutdown:", Cause.squash(cause)),
          ),
        ),
        Effect.ensuring(
          managed.disposeEffect.pipe(
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
    bundle?.closeAdmission();
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
