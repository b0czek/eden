import * as Context from "effect/Context";
import type { RuntimeContexts } from "../execution/runtime-contexts";
import type { Filesystem } from "../filesystem";
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

export const PackagesPermissions = Context.Service<
  "eden/PackagesPermissions",
  PackagePermissions
>("eden/PackagesPermissions");

export const PackagesFilesystem = Context.Service<
  "eden/PackagesFilesystem",
  PackageFilesystem
>("eden/PackagesFilesystem");

export const PackagesRuntimeContexts = Context.Service<
  "eden/PackagesRuntimeContexts",
  PackageRuntimeContexts
>("eden/PackagesRuntimeContexts");
