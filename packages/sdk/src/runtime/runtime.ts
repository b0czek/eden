import * as fs from "node:fs";
import * as path from "node:path";
import type { EdenConfig } from "@edenapp/types";
import type { EdenLifecycleState } from "../api";
import { resolveBrandingName } from "../branding";
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
  let startPromise: Promise<void> | undefined;
  let disposePromise: Promise<void> | undefined;
  let resourcesDisposed = false;
  let readySettled = false;
  let resolveReady!: () => void;
  let rejectReady!: (error: unknown) => void;
  const readyPromise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
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
  function assertStartupActive() {
    if (state !== "starting")
      throw new Error("Eden runtime startup aborted by shutdown");
  }
  async function startInternal() {
    try {
      log.info("Eden starting...");
      await seedDatabase(
        paths.appsDirectory,
        config.seedPath ?? path.join(paths.distPath, "eden-seed.json"),
        paths.userDirectory,
      );
      bundle = await effects.acquire(
        composeRuntime({ config, paths, platform, effects, registrations }),
      );
      const { services, appearance, associations } = bundle;
      await effects.run(services.users.initialize());
      await effects.run(services.packages.initialize());
      services.settingsPanels.synchronizeManifestPanels();
      await effects.run(services.daemons.initialize());
      await effects.run(services.sessions.initialize());
      await effects.run(appearance.initialize());
      await effects.run(associations.initialize());
      assertStartupActive();
      await effects.run(bundle.foundation.open());
      assertStartupActive();
      state = "ready";
      readySettled = true;
      resolveReady();
      log.info("Eden ready!");
    } catch (error) {
      try {
        await disposeResources();
      } catch (cleanupError) {
        log.error("Error disposing failed Eden startup:", cleanupError);
      } finally {
        if (state !== "stopping") state = "failed";
        readySettled = true;
        rejectReady(error);
      }
      if (state === "failed") log.error("Eden failed to start", error);
      throw error;
    }
  }
  function start() {
    if (state === "starting" && startPromise) return startPromise;
    if (state === "ready") return startPromise ?? Promise.resolve();
    if (state !== "created")
      return Promise.reject(
        new Error(`Cannot start Eden runtime from ${state} state`),
      );
    state = "starting";
    startPromise = startInternal();
    return startPromise;
  }
  async function disposeResources() {
    if (resourcesDisposed) return;
    resourcesDisposed = true;
    try {
      if (bundle) await effects.run(bundle.shutdown());
    } finally {
      try {
        await effects.dispose();
      } catch (error) {
        log.error("Failed to dispose Eden service scope:", error);
      } finally {
        registrations.dispose();
      }
    }
  }
  function dispose() {
    if (disposePromise) return disposePromise;
    const beforeStart = state === "created";
    state = "stopping";
    if (beforeStart && !readySettled) {
      readySettled = true;
      rejectReady(new Error("Eden runtime disposed before startup"));
    }
    disposePromise = (async () => {
      try {
        if (startPromise) await startPromise.catch(() => undefined);
        await disposeResources();
      } catch (error) {
        log.error("Error during shutdown:", error);
      } finally {
        state = "stopped";
      }
    })();
    return disposePromise;
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
