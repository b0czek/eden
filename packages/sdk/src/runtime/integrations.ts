import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as FiberSet from "effect/FiberSet";
import { Appearance } from "../appearance/service";
import { connectDaemonLifecycle } from "../daemon/lifecycle";
import { Daemons } from "../daemon/service";
import { listen } from "../events/scoped";
import { Filesystem } from "../filesystem/service";
import { IpcTransport } from "../ipc/transport";
import { log } from "../logging/logger";
import { Packages } from "../packages/service";
import { Backends } from "../processes/backends";
import { Processes } from "../processes/service";
import { Sessions } from "../session/service";
import { connectSettingsLifecycle } from "../settings/lifecycle";
import { registerBuiltinSettingsPanels } from "../settings/panels/builtin/registration";
import { SettingsPanels } from "../settings/panels/service";
import { Settings } from "../settings/service";
import { GrantCatalog } from "../user/grant-catalog";
import { Users } from "../user/service";
import { Views } from "../views/service";
import { RuntimeEnvironment } from "./environment";

export const connectRuntimeLifecycle = Effect.fn(function* () {
  const { config } = yield* RuntimeEnvironment;
  const appearance = yield* Appearance;
  const daemons = yield* Daemons;
  const filesystem = yield* Filesystem;
  const ipc = yield* IpcTransport;
  const packages = yield* Packages;
  const backends = yield* Backends;
  const processes = yield* Processes;
  const sessions = yield* Sessions;
  const settingsPanels = yield* SettingsPanels;
  const settings = yield* Settings;
  const grants = yield* GrantCatalog;
  const users = yield* Users;
  const views = yield* Views;
  yield* connectDaemonLifecycle(daemons, processes, packages);
  yield* connectSettingsLifecycle(
    settingsPanels,
    sessions,
    packages,
    daemons,
    grants,
  );
  yield* Effect.gen(function* () {
    yield* listen(views.viewRemoved, ({ viewId }) =>
      ipc.eventSubscribers.removeViewSubscriptions(viewId),
    );
    const forkCleanup = yield* FiberSet.makeRuntime<never, void, never>();
    function closeProcessHandles({ appId }: { appId: string }) {
      forkCleanup(
        filesystem
          .closeOwner({ appId })
          .pipe(
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.failCause(cause)
                : Effect.sync(() =>
                    log.error(
                      "Failed to close process file handles:",
                      Cause.squash(cause),
                    ),
                  ),
            ),
          ),
      );
    }
    yield* listen(processes.stopped, closeProcessHandles);
    // Native exit closes handle admission before asynchronous instance teardown.
    yield* listen(backends.backendExit, closeProcessHandles);
  });
  registerBuiltinSettingsPanels({
    panels: settingsPanels,
    settings,
    appearance,
    packages,
    daemons,
    users,
    config,
  });
});
