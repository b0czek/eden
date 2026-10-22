import type { FilesystemLocation } from "@edenapp/types";
import * as Data from "effect/Data";
import type { FilesystemIoFailed } from "../../platform/filesystem/native-errors";

/** A package mutation violates current catalog or host state. */
export class PackageRejected extends Data.TaggedError("PackageRejected")<{
  reason:
    | "package-id"
    | "host-running"
    | "protected-package"
    | "replacement-required"
    | "incompatible"
    | "invalid-archive"
    | "missing-host"
    | "not-installed"
    | "missing-path"
    | "invalid-manifest";
  packageId?: string;
  message: string;
}> {}

/** Reading or extracting an archive failed before publication. */
export class PackageArchiveError extends Data.TaggedError(
  "PackageArchiveError",
)<{
  path: string;
  operation: "read" | "inspect" | "extract";
  message: string;
  cause: unknown;
}> {}

export class PackageDevelopmentError extends Data.TaggedError(
  "PackageDevelopmentError",
)<{
  packageId: string;
  operation: "reload" | "save-preference";
  message: string;
  cause: unknown;
}> {}

export class PackageInitializationError extends Data.TaggedError(
  "PackageInitializationError",
)<{
  message: string;
  cause: unknown;
}> {}

export class PackageJournalError extends Data.TaggedError(
  "PackageJournalError",
)<{
  directory: string;
  message: string;
  cause?: unknown;
}> {}

export class PackageRollbackError extends Data.TaggedError(
  "PackageRollbackError",
)<{
  directory: string;
  message: string;
  cause: unknown;
  rollbackCause: unknown;
}> {}

export type PackageTransactionFailure =
  | FilesystemIoFailed
  | PackageJournalError
  | PackageRollbackError;
export class PackageLocationError extends Data.TaggedError(
  "PackageLocationError",
)<{
  location: FilesystemLocation;
  message: string;
  cause: unknown;
}> {}

export type PackageArchiveInstallError =
  | PackageRejected
  | PackageArchiveError
  | PackageTransactionFailure;
export type PackageInstallError =
  | PackageLocationError
  | PackageArchiveInstallError;
export type PackageDevelopmentFailure =
  | PackageRejected
  | PackageDevelopmentError
  | FilesystemIoFailed;
export type PackageRemovalError = PackageRejected | PackageTransactionFailure;

export class PackageResourceError extends Data.TaggedError(
  "PackageResourceError",
)<{
  packageId: string;
  relativePath: string;
  reason: "not-installed" | "invalid-path" | "outside-root" | "read";
  message: string;
  cause?: unknown;
}> {}
