import type { InstalledPackageManifest } from "@edenapp/types";

/**
 * Package installation and removal notifications.
 */
export interface PackageEvents {
  installed: {
    manifest: InstalledPackageManifest;
  };
  uninstalled:
    | {
        kind: "app";
        packageId: string;
      }
    | {
        kind: "dlc";
        packageId: string;
        hostAppId: string;
      };
}
export interface InstalledPackageListOptions {
  showHidden?: boolean;
  showRestricted?: boolean;
  kind?: "app" | "dlc";
  hostAppId?: string;
}
