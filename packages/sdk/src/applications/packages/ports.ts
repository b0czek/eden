import type { RuntimeContexts } from "../../core/execution/runtime-contexts";
import type { Permissions } from "../../core/ipc/permissions";

export type PackagePermissions = Pick<
  Permissions,
  "registerApp" | "unregisterApp"
>;
export type PackageRuntimeContexts = Pick<RuntimeContexts, "get">;
