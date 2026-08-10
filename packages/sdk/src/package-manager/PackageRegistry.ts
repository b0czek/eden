import type {
  InstalledPackageManifest,
  RuntimeAppManifest,
  RuntimeDlcManifest,
} from "@edenapp/types";
import { injectable, Lifecycle, scoped } from "tsyringe";

export interface PackageRegistrationOptions {
  /** Filesystem source used by packages mounted directly for development. */
  sourcePath?: string;
}

/** Mutable package registration store. PackageManager owns all writes. */
@scoped(Lifecycle.ContainerScoped)
@injectable()
export class PackageRegistry {
  private readonly manifests = new Map<string, InstalledPackageManifest>();
  private readonly sourcePaths = new Map<string, string>();

  register(
    manifest: InstalledPackageManifest,
    options: PackageRegistrationOptions = {},
  ): void {
    this.manifests.set(manifest.id, structuredClone(manifest));
    if (options.sourcePath) {
      this.sourcePaths.set(manifest.id, options.sourcePath);
    } else {
      this.sourcePaths.delete(manifest.id);
    }
  }

  unregister(packageId: string): boolean {
    this.sourcePaths.delete(packageId);
    return this.manifests.delete(packageId);
  }

  get(packageId: string): InstalledPackageManifest | undefined {
    const manifest = this.manifests.get(packageId);
    return manifest ? structuredClone(manifest) : undefined;
  }

  all(): InstalledPackageManifest[] {
    return [...this.manifests.values()].map((manifest) =>
      structuredClone(manifest),
    );
  }

  getApp(appId: string): RuntimeAppManifest | undefined {
    const manifest = this.get(appId);
    return manifest?.kind === "app" ? manifest : undefined;
  }

  getDlc(dlcId: string): RuntimeDlcManifest | undefined {
    const manifest = this.get(dlcId);
    return manifest?.kind === "dlc" ? manifest : undefined;
  }

  getSourcePath(packageId: string): string | undefined {
    return this.sourcePaths.get(packageId);
  }
}
