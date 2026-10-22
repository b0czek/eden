import * as Effect from "effect/Effect";
import { Daemons } from "../applications/daemon/service";
import { PackageCatalog } from "../applications/packages/catalog";
import { DlcResources } from "../applications/packages/dlc-resources";
import { InstalledPackages } from "../applications/packages/installed";
import { Packages } from "../applications/packages/service";
import { PackageTransactions } from "../applications/packages/transactions";
import { Backends } from "../applications/processes/backends";
import { Processes } from "../applications/processes/service";
import { ExecutionContext } from "../core/execution/context";
import { RuntimeContexts } from "../core/execution/runtime-contexts";
import { Commands } from "../core/ipc/commands";
import { Permissions } from "../core/ipc/permissions";
import { IpcTransport } from "../core/ipc/transport";
import { Operations } from "../core/operations/service";
import { SettingsPanels } from "../core/settings/panels/service";
import { Settings } from "../core/settings/service";
import { GrantCatalog } from "../core/user/grant-catalog";
import { Users } from "../core/user/service";
import { SessionContext } from "../desktop/session/context";
import { Sessions } from "../desktop/session/service";
import { Views } from "../desktop/views/service";
import { Filesystem } from "../platform/filesystem/service";
import { Volumes } from "../platform/filesystem/volumes/service";

/** Inspection API for existing callers; runtime assembly uses service keys. */
export const inspectRuntimeServices = Effect.gen(function* () {
  return {
    execution: yield* ExecutionContext,
    runtimeContexts: yield* RuntimeContexts,
    sessionContext: yield* SessionContext,
    permissions: yield* Permissions,
    operations: yield* Operations,
    commands: yield* Commands,
    ipc: yield* IpcTransport,
    installedPackages: yield* InstalledPackages,
    catalog: yield* PackageCatalog,
    packageTransactions: yield* PackageTransactions,
    dlcResources: yield* DlcResources,
    settings: yield* Settings,
    settingsPanels: yield* SettingsPanels,
    grants: yield* GrantCatalog,
    views: yield* Views,
    backends: yield* Backends,
    filesystem: yield* Filesystem,
    volumes: yield* Volumes,
    packages: yield* Packages,
    processes: yield* Processes,
    users: yield* Users,
    sessions: yield* Sessions,
    daemons: yield* Daemons,
  };
});

export type RuntimeServices = Effect.Success<typeof inspectRuntimeServices>;
