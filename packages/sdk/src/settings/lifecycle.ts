import * as Effect from "effect/Effect";
import type { Daemons } from "../daemon/service";
import { listen } from "../events/scoped";
import type { Packages } from "../packages/service";
import type { Sessions } from "../session/service";
import type { GrantCatalog } from "../user/grant-catalog";
import type { SettingsPanels } from "./panel-service";
export const connectSettingsLifecycle = Effect.fn(function* (
  panels: SettingsPanels,
  sessions: Sessions,
  packages: Packages,
  daemons: Daemons,
  grants: GrantCatalog,
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
