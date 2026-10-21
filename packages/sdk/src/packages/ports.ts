import type { RuntimeContexts } from "../execution/runtime-contexts";
import type { Permissions } from "../ipc/permissions";

export type PackagePermissions = Pick<
  Permissions,
  "registerApp" | "unregisterApp"
>;
export type PackageRuntimeContexts = Pick<RuntimeContexts, "get">;
