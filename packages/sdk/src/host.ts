import * as path from "node:path";
import type { EdenConfig } from "@edenapp/types";
import { log } from "./logging";
import { createElectronPlatform } from "./platform/electron";
import type { ApplicationLifecyclePort } from "./platform/ports";
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
  const unsubscribe = [
    application.on("window-all-closed", () => application.quit()),
    application.on("activate", () => runtime.activate()),
    application.on("quit-requested", () => {
      void dispose()
        .finally(() => application.completeQuit())
        .catch((error) => {
          log.error("Failed to dispose Eden before quitting:", error);
        });
    }),
  ];

  function dispose(): Promise<void> {
    disposal ??= (async () => {
      for (const stop of unsubscribe) stop();
      await runtime.dispose();
    })();
    return disposal;
  }

  void application
    .whenReady()
    .then(() => {
      if (!disposal) return runtime.start();
    })
    .catch(() => undefined);

  return {
    settings: runtime.settings,
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
