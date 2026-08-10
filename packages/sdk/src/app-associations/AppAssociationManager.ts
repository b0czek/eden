import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  AppAssociation,
  AppAssociationStore,
  RuntimeAppManifest,
} from "@edenapp/types";
import { delay, inject, injectable, Lifecycle, scoped } from "tsyringe";
import { CommandRegistry, EdenNamespace } from "../ipc";
import { log } from "../logging";
import { PackageCatalog } from "../package-manager/PackageCatalog";
import { AppAssociationHandler } from "./AppAssociationHandler";

export interface AppAssociationListOptions {
  kindPrefix?: string;
}

@scoped(Lifecycle.ContainerScoped)
@injectable()
@EdenNamespace("associations")
export class AppAssociationManager {
  private static readonly STORE_VERSION = 1;
  private readonly associationsPath: string;
  private readonly handler: AppAssociationHandler;
  private associations = new Map<string, AppAssociation>();
  private initialized = false;

  constructor(
    @inject("userDirectory") userDirectory: string,
    @inject(CommandRegistry) commandRegistry: CommandRegistry,
    @inject(delay(() => PackageCatalog)) private packageCatalog: PackageCatalog,
  ) {
    this.associationsPath = path.join(userDirectory, "app-associations.json");
    this.handler = new AppAssociationHandler(this);
    commandRegistry.registerManager(this.handler);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    try {
      const content = await fs.readFile(this.associationsPath, "utf-8");
      const store = JSON.parse(content) as Partial<AppAssociationStore>;

      if (
        store.version !== AppAssociationManager.STORE_VERSION ||
        !store.associations ||
        typeof store.associations !== "object"
      ) {
        this.associations = new Map();
        return;
      }

      this.associations = new Map(
        Object.entries(store.associations).filter(([, association]) =>
          this.isValidAssociation(association),
        ),
      );
    } catch {
      this.associations = new Map();
    }
  }

  get(key: string): AppAssociation | undefined {
    const association = this.associations.get(key);
    return association ? { ...association } : undefined;
  }

  resolve(
    key: string,
    matches: (app: RuntimeAppManifest) => boolean,
  ): AppAssociation[] {
    const association = this.get(key);
    if (association) {
      const app = this.packageCatalog.getLaunchableApp(association.appId);
      if (app && matches(app)) {
        return [association];
      }
    }

    return this.packageCatalog
      .listApps({ showHidden: true })
      .filter(matches)
      .map((app) => ({
        appId: app.id,
        kind: "provider",
      }));
  }

  async set(key: string, association: AppAssociation): Promise<void> {
    this.validateKey(key);
    if (!this.isValidAssociation(association)) {
      throw new Error("Invalid app association");
    }

    this.associations.set(key, { ...association });
    await this.save();
  }

  async remove(key: string): Promise<void> {
    this.validateKey(key);
    this.associations.delete(key);
    await this.save();
  }

  list(
    options: AppAssociationListOptions = {},
  ): Record<string, AppAssociation> {
    const result: Record<string, AppAssociation> = {};

    for (const [key, association] of this.associations) {
      if (
        options.kindPrefix &&
        !association.kind.startsWith(options.kindPrefix)
      ) {
        continue;
      }

      result[key] = { ...association };
    }

    return result;
  }

  private async save(): Promise<void> {
    const store: AppAssociationStore = {
      version: AppAssociationManager.STORE_VERSION,
      associations: Object.fromEntries(this.associations),
    };

    await fs.mkdir(path.dirname(this.associationsPath), { recursive: true });
    await fs.writeFile(
      this.associationsPath,
      `${JSON.stringify(store, null, 2)}\n`,
    );
  }

  private validateKey(key: string): void {
    if (!key.trim()) {
      throw new Error("Association key is required");
    }
  }

  private isValidAssociation(
    association: unknown,
  ): association is AppAssociation {
    if (!association || typeof association !== "object") return false;
    const candidate = association as Partial<AppAssociation>;
    const valid =
      typeof candidate.appId === "string" &&
      candidate.appId.trim().length > 0 &&
      typeof candidate.kind === "string" &&
      candidate.kind.trim().length > 0 &&
      (candidate.label === undefined || typeof candidate.label === "string");

    if (!valid) {
      log.warn("Ignoring invalid app association entry");
    }

    return valid;
  }

  dispose(): void {
    this.associations.clear();
    this.initialized = false;
  }
}
