import type {
  InstalledPackageManifest,
  RuntimeAppManifest,
  RuntimeDlcManifest,
} from "@edenapp/types";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export interface InstalledPackages {
  register: (
    manifest: InstalledPackageManifest,
    options?: PackageRegistrationOptions,
  ) => void;
  unregister: (packageId: string) => boolean;
  get: (packageId: string) => InstalledPackageManifest | undefined;
  all: () => InstalledPackageManifest[];
  getApp: (appId: string) => RuntimeAppManifest | undefined;
  getDlc: (dlcId: string) => RuntimeDlcManifest | undefined;
  getSourcePath: (packageId: string) => string | undefined;
}

export const InstalledPackages = Context.Service<
  "eden/InstalledPackages",
  InstalledPackages
>("eden/InstalledPackages");

export interface PackageRegistrationOptions {
  /** Filesystem source used by packages mounted directly for development. */
  sourcePath?: string;
}

export const InstalledPackagesLive = Layer.effect(
  InstalledPackages,
  Effect.sync(() => {
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
      return [...manifests.values()].map((manifest) =>
        structuredClone(manifest),
      );
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
  }),
);
