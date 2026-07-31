import type {
  RuntimeAppManifest,
  UserGrantOption,
  UserGrantOptionsResponse,
} from "@edenapp/types";
import { inject, Lifecycle, scoped } from "tsyringe";
import { AppCatalog } from "../app-registry";
import { EdenEmitter, EdenNamespace, IPCBridge } from "../ipc";
import { PackageManager } from "../package-manager";
import { SettingsPanelManager } from "../settings";

interface GrantCatalogEvents {
  "grant-options-changed": { revision: number };
}

@scoped(Lifecycle.ContainerScoped)
@EdenNamespace("user")
export class GrantCatalogManager extends EdenEmitter<GrantCatalogEvents> {
  private revision = 1;
  private invalidationQueued = false;

  constructor(
    @inject(IPCBridge) ipcBridge: IPCBridge,
    @inject(AppCatalog) private readonly appCatalog: AppCatalog,
    @inject(SettingsPanelManager)
    private readonly settingsPanels: SettingsPanelManager,
    @inject(PackageManager) packageManager: PackageManager,
  ) {
    super(ipcBridge);
    settingsPanels.on("panels-changed", ({ reason }) => {
      if (reason === "catalog") this.invalidate();
    });
    packageManager.on("installed", () => this.invalidate());
    packageManager.on("uninstalled", () => this.invalidate());
  }

  getOptions(): UserGrantOptionsResponse {
    const options = new Map<string, UserGrantOption>();
    const add = (option: UserGrantOption) => {
      if (!option.grant || options.has(option.grant)) return;
      options.set(option.grant, structuredClone(option));
    };

    for (const app of this.appCatalog.all()) {
      this.addAppOptions(app, add);
    }
    for (const option of this.settingsPanels.listGrantOptions()) add(option);

    return {
      revision: this.revision,
      options: Array.from(options.values()).sort((a, b) =>
        a.grant.localeCompare(b.grant),
      ),
    };
  }

  private addAppOptions(
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

  private invalidate(): void {
    if (this.invalidationQueued) return;
    this.invalidationQueued = true;
    queueMicrotask(() => {
      this.invalidationQueued = false;
      this.revision += 1;
      this.notify("grant-options-changed", { revision: this.revision });
    });
  }
}
