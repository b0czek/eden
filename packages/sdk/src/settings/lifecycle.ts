import * as Effect from "effect/Effect";
import type { DaemonManager } from "../daemon/DaemonManager";
import { listen } from "../events/scoped";
import type { PackageManager } from "../package-manager/PackageManager";
import type { SessionManager } from "../session/SessionManager";
import type { GrantCatalogManager } from "../user/GrantCatalogManager";
import type { SettingsPanelManager } from "./SettingsPanelManager";
export const connectSettingsLifecycle = Effect.fn(function* (
  panels: SettingsPanelManager,
  sessions: SessionManager,
  packages: PackageManager,
  daemons: DaemonManager,
  grants: GrantCatalogManager,
) {
  yield* listen(sessions.changed, ({ currentUser, previousUsername }) =>
    panels.invalidate(
      currentUser?.username === previousUsername ? "grants" : "session",
    ),
  );
  yield* listen(packages.installed, ({ manifest }) => {
    if (manifest.kind === "app") panels.synchronizeManifestPanel(manifest);
    panels.invalidate("catalog");
  });
  yield* listen(packages.uninstalled, (change) => {
    if (change.kind === "app") panels.removeManifestPanel(change.packageId);
    panels.invalidate("catalog");
  });
  yield* listen(daemons.changed, () => panels.invalidate("state"));
  yield* listen(panels.changed, ({ reason }) => {
    if (reason === "catalog") grants.invalidate();
  });
  yield* listen(packages.installed, () => grants.invalidate());
  yield* listen(packages.uninstalled, () => grants.invalidate());
});
