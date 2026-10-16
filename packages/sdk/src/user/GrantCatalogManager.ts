import type {
  RuntimeAppManifest,
  UserGrantOption,
  UserGrantOptionsResponse,
} from "@edenapp/types";
import { createEvent } from "../events/event";
import { PackageCatalog } from "../package-manager/PackageCatalog";
import { SettingsPanelManager } from "../settings";

interface GrantCatalogEvents {
  "grant-options-changed": { revision: number };
}

export function createGrantCatalogManager({
  packageCatalog,
  settingsPanels,
}: {
  packageCatalog: Pick<PackageCatalog, "allApps">;
  settingsPanels: Pick<SettingsPanelManager, "listGrantOptions">;
}) {
  const changed = createEvent<GrantCatalogEvents["grant-options-changed"]>();
  let active = true;
  let revision = 1;
  let invalidationQueued = false;

  function getOptions(): UserGrantOptionsResponse {
    const options = new Map<string, UserGrantOption>();
    const add = (option: UserGrantOption) => {
      if (!option.grant || options.has(option.grant)) return;
      options.set(option.grant, structuredClone(option));
    };

    for (const app of packageCatalog.allApps()) {
      addAppOptions(app, add);
    }
    for (const option of settingsPanels.listGrantOptions()) add(option);

    return {
      revision: revision,
      options: Array.from(options.values()).sort((a, b) =>
        a.grant.localeCompare(b.grant),
      ),
    };
  }
  function addAppOptions(
    app: RuntimeAppManifest,
    add: (option: UserGrantOption) => void,
  ): void {
    if (!app.isCore && !app.isRestricted) {
      add({
        grant: `apps/launch/${app.id}`,
        kind: "app-launch",
        label: app.name,
        description: app.description,
        ownerId: app.id,
        ownerLabel: app.name,
      });
    }

    for (const grant of app.resolvedGrants) {
      const id = grant.scope === "preset" ? grant.preset : grant.id;
      if (!id) continue;
      add({
        grant:
          grant.scope === "preset" ? `preset/${id}` : `app/${app.id}/${id}`,
        kind: grant.scope === "preset" ? "preset" : "app-feature",
        label: grant.label ?? id,
        description: grant.description,
        ownerId: app.id,
        ownerLabel: app.name,
      });
    }
  }
  function invalidate(): void {
    if (invalidationQueued) return;
    invalidationQueued = true;
    queueMicrotask(() => {
      invalidationQueued = false;
      if (!active) return;
      revision += 1;
      changed.emit({ revision });
    });
  }
  return {
    getOptions,
    invalidate,
    changed,
    dispose: () => {
      active = false;
      changed.dispose();
    },
  };
}
export type GrantCatalogManager = ReturnType<typeof createGrantCatalogManager>;
