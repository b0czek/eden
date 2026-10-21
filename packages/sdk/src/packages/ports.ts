import type { RuntimeContexts } from "../execution/runtime-contexts";
import type { Filesystem } from "../filesystem/service";
import type { Permissions } from "../ipc/permissions";

export type PackagePermissions = Pick<
  Permissions,
  "registerApp" | "unregisterApp"
>;
export type PackageFilesystem = Pick<
  Filesystem,
  "withVolume" | "prepareVolumeOperation"
>;
export type PackageRuntimeContexts = Pick<RuntimeContexts, "get">;
