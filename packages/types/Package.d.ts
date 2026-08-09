import type {
  InstalledPackageManifest,
  RuntimeAppManifest,
  RuntimeDlcManifest,
} from "./AppManifest";

/** A host-scoped installed DLC and the root URL used to consume its payload. */
export interface DlcResource {
  manifest: RuntimeDlcManifest;
  /** Caller-scoped URL ending in `/`; resolve host-defined contribution paths against it. */
  rootUrl: string;
}

/** Details for an installed package. DLC packages return an empty DLC list. */
export interface InstalledPackageInfo {
  manifest: InstalledPackageManifest;
  dlcs: DlcResource[];
}

/** Runtime installation preview returned when inspecting an .edenite package. */
export type PackageOperationPreview =
  | {
      kind: "app";
      existingVersion?: string;
      incompatibleDlcs: RuntimeDlcManifest[];
      hostRunning: boolean;
      replaceable: boolean;
    }
  | {
      kind: "dlc";
      existingVersion?: string;
      host?: RuntimeAppManifest;
      compatibilityErrors: string[];
      hostRunning: boolean;
      replaceable: boolean;
    };
