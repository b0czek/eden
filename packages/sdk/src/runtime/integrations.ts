import * as Effect from "effect/Effect";
import * as FiberSet from "effect/FiberSet";
import { connectDaemonLifecycle } from "../applications/daemon/lifecycle";
import { Daemons } from "../applications/daemon/service";
import { Packages } from "../applications/packages/service";
import { Backends } from "../applications/processes/backends";
import { Processes } from "../applications/processes/service";
import { logBackgroundFailure } from "../core/effects/failure-policy";
import { listen } from "../core/events/scoped";
import { IpcTransport } from "../core/ipc/transport";
import { connectSettingsLifecycle } from "../core/settings/lifecycle";
import { registerBuiltinSettingsPanels } from "../core/settings/panels/builtin/registration";
import { SettingsPanels } from "../core/settings/panels/service";
import { Settings } from "../core/settings/service";
import { GrantCatalog } from "../core/user/grant-catalog";
import { Users } from "../core/user/service";
import { Appearance } from "../desktop/appearance/service";
import { Sessions } from "../desktop/session/service";
import { Views } from "../desktop/views/service";
import { Filesystem } from "../platform/filesystem/service";
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
          .pipe(logBackgroundFailure("Failed to close process file handles:")),
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
