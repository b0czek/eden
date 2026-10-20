import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import { AppAssociations } from "../app-associations/service";
import { Appearance } from "../appearance/service";
import { Autostart } from "../autostart/service";
import { Daemons } from "../daemon/service";
import { Filesystem } from "../filesystem/service";
import { log } from "../logging";
import { Operations } from "../operations/service";
import { Packages } from "../packages/service";
import { Processes } from "../processes/service";
import { Sessions } from "../session/service";
import { SettingsPanels } from "../settings/panels/service";
import { Users } from "../user/service";
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
  const shutdown = Effect.fn(function* () {
    operations.closeAdmission();
    yield* shutdownPhase("filesystem handles", filesystem.closeHandles());
    yield* shutdownPhase("operation drain", operations.shutdown());
    yield* shutdownPhase("autostart", autostart.shutdown());
    yield* shutdownPhase("daemons", daemons.shutdown());
    yield* shutdownPhase("processes", processes.shutdown());
  });
  return { initialize, shutdown, closeAdmission: operations.closeAdmission };
});

function shutdownPhase<A, E>(name: string, work: Effect.Effect<A, E>) {
  return Effect.catchCause(work, (cause) =>
    Effect.sync(() =>
      log.error(`Failed to shut down Eden ${name}:`, Cause.squash(cause)),
    ),
  );
}
