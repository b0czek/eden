import type {
  InstalledPackageManifest,
  PackageManifest,
  PackageOperationPreview,
} from "@edenapp/types";

export interface PackageInspection {
  manifest: PackageManifest;
  checksum?: string;
  preview: PackageOperationPreview;
}

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
