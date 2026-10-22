import * as Effect from "effect/Effect";
import { AppAssociations } from "../applications/app-associations/service";
import { Autostart } from "../applications/autostart/service";
import { Daemons } from "../applications/daemon/service";
import { Packages } from "../applications/packages/service";
import { Processes } from "../applications/processes/service";
import { logCleanupFailure } from "../core/effects/failure-policy";
import { Operations } from "../core/operations/service";
import { SettingsPanels } from "../core/settings/panels/service";
import { Users } from "../core/user/service";
import { Appearance } from "../desktop/appearance/service";
import { Sessions } from "../desktop/session/service";
import { Filesystem } from "../platform/filesystem/service";
import type { FoundationWindow } from "./foundation-window";

/** Capture lifecycle dependencies once; returned operations are fully provided. */
export const acquireDesktopLifecycle = Effect.fn(function* (
  foundation: FoundationWindow,
) {
  const users = yield* Users;
  const packages = yield* Packages;
  const settingsPanels = yield* SettingsPanels;
  const daemons = yield* Daemons;
  const sessions = yield* Sessions;
  const appearance = yield* Appearance;
  const associations = yield* AppAssociations;
  const operations = yield* Operations;
  const filesystem = yield* Filesystem;
  const autostart = yield* Autostart;
  const processes = yield* Processes;

  const initialize = Effect.fn(function* () {
    yield* users.initialize();
    yield* packages.initialize();
    settingsPanels.synchronizeManifestPanels();
    yield* daemons.initialize();
    yield* sessions.initialize();
    yield* appearance.initialize();
    yield* associations.initialize();
    yield* foundation.open();
  });
  const shutdown = Effect.uninterruptible(
    yield* Effect.cached(
      Effect.gen(function* () {
        operations.closeAdmission();
        yield* shutdownPhase("filesystem handles", filesystem.closeHandles());
        yield* shutdownPhase("operation drain", operations.shutdown());
        yield* shutdownPhase("autostart", autostart.shutdown());
        yield* shutdownPhase("daemons", daemons.shutdown());
        yield* shutdownPhase("processes", processes.shutdown());
      }),
    ),
  );
  return {
    initialize,
    shutdown: () => shutdown,
    closeAdmission: operations.closeAdmission,
  };
});

function shutdownPhase<A, E>(name: string, work: Effect.Effect<A, E>) {
  return work.pipe(logCleanupFailure(`Failed to shut down Eden ${name}:`));
}
