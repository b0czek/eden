import * as path from "node:path";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import type { EdenConfig } from "./api/config";
import { createElectronPlatform } from "./platform/electron/platform";
import { log } from "./platform/logging/logger";
import type { ApplicationLifecyclePort } from "./platform/ports/types";
import { createEdenRuntime, type EdenRuntime } from "./runtime/runtime";

/** Create and start an isolated Eden desktop in the Electron main process. */
export function createEden(config: EdenConfig = {}) {
  const platform = createElectronPlatform();
  // Electron requires privileged schemes before application readiness.
  platform.resources.registerSchemes(["eden-dlc"]);
  const application = platform.application;
  application.appendCommandLineSwitch("enable-features", "V8CodeCache");

  const runtime = createEdenRuntime({
    config,
    platform,
    paths: {
      appsDirectory:
        config.appsDirectory ??
        path.join(application.getPath("userData"), "eden-apps"),
      userDirectory:
        config.userDirectory ??
        path.join(application.getPath("userData"), "eden-user"),
      distPath: path.join(process.cwd(), "dist"),
      appPath: application.getAppPath(),
    },
  });
  return createEdenHost({ runtime, application });
}

/** Compose an already-owned runtime with the application's lifecycle. */
export function createEdenHost({
  runtime,
  application,
}: {
  runtime: EdenRuntime;
  application: ApplicationLifecyclePort;
}) {
  let disposal: Promise<void> | undefined;
  const scope = Scope.makeUnsafe("sequential");

  function dispose(): Promise<void> {
    // @eden-effect-next-line domain-interpreter -- Native application shutdown awaits the owned host scope and runtime disposal.
    disposal ??= Effect.runPromise(
      Scope.close(scope, Exit.void).pipe(
        Effect.ensuring(Effect.promise(() => runtime.dispose())),
      ),
    );
    return disposal;
  }

  // @eden-effect-next-line domain-interpreter -- Host entry point registers synchronous native lifecycle callbacks in its owned scope.
  Effect.runSync(
    Scope.provide(
      Effect.gen(function* () {
        const on = (
          event: Parameters<ApplicationLifecyclePort["on"]>[0],
          listener: () => void,
        ) =>
          Effect.acquireRelease(
            Effect.sync(() => application.on(event, listener)),
            (stop) => Effect.sync(stop),
          );
        yield* on("window-all-closed", () => application.quit());
        yield* on("activate", () => runtime.activate());
        yield* on("quit-requested", () => {
          void dispose()
            .finally(() => application.completeQuit())
            .catch((error) => {
              log.error("Failed to dispose Eden before quitting:", error);
            });
        });
        yield* Effect.forkScoped(
          // Application readiness owns no native resources and can be abandoned on shutdown.
          Effect.promise(() => application.whenReady()).pipe(
            Effect.andThen(
              Effect.suspend(() =>
                disposal ? Effect.void : Effect.promise(() => runtime.start()),
              ),
            ),
            Effect.catchCause(() => Effect.void),
          ),
        );
      }),
      scope,
    ),
  );

  return {
    settings: runtime.settings,
    runPromise: runtime.effects.run,
    runFork: runtime.effects.fork,
    whenReady: () => runtime.whenReady(),
    dispose,
    get state() {
      return runtime.state;
    },
    get operations() {
      return runtime.operations;
    },
    get volumes() {
      return runtime.volumes;
    },
    get packages() {
      return runtime.packages;
    },
    get daemons() {
      return runtime.daemons;
    },
    get users() {
      return runtime.users;
    },
    get sessions() {
      return runtime.sessions;
    },
    get appearance() {
      return runtime.appearance;
    },
    get associations() {
      return runtime.associations;
    },
  };
}

export type Eden = ReturnType<typeof createEden>;
