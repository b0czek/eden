import type {
  InstalledPackageManifest,
  RuntimeAppManifest,
  RuntimeDlcManifest,
} from "@edenapp/types";
export interface PackageRegistrationOptions {
  /** Filesystem source used by packages mounted directly for development. */
  sourcePath?: string;
}

export const createPackageRegistry = () => {
  const manifests = new Map<string, InstalledPackageManifest>();
  const sourcePaths = new Map<string, string>();
  function register(
    manifest: InstalledPackageManifest,
    options: PackageRegistrationOptions = {},
  ): void {
    manifests.set(manifest.id, structuredClone(manifest));
    if (options.sourcePath) {
      sourcePaths.set(manifest.id, options.sourcePath);
    } else {
      sourcePaths.delete(manifest.id);
    }
  }

  function unregister(packageId: string): boolean {
    sourcePaths.delete(packageId);
    return manifests.delete(packageId);
  }

  function get(packageId: string): InstalledPackageManifest | undefined {
    const manifest = manifests.get(packageId);
    return manifest ? structuredClone(manifest) : undefined;
  }

  function all(): InstalledPackageManifest[] {
    return [...manifests.values()].map((manifest) => structuredClone(manifest));
  }

  function getApp(appId: string): RuntimeAppManifest | undefined {
    const manifest = get(appId);
    return manifest?.kind === "app" ? manifest : undefined;
  }

  function getDlc(dlcId: string): RuntimeDlcManifest | undefined {
    const manifest = get(dlcId);
    return manifest?.kind === "dlc" ? manifest : undefined;
  }

  function getSourcePath(packageId: string): string | undefined {
    return sourcePaths.get(packageId);
  }
  return { register, unregister, get, all, getApp, getDlc, getSourcePath };
};
export type PackageRegistry = ReturnType<typeof createPackageRegistry>;
