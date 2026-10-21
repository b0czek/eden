import * as Effect from "effect/Effect";
import { Daemons } from "../daemon/service";
import { ExecutionContext } from "../execution/context";
import { RuntimeContexts } from "../execution/runtime-contexts";
import { Filesystem } from "../filesystem/service";
import { Volumes } from "../filesystem/volumes/service";
import { Commands } from "../ipc/commands";
import { Permissions } from "../ipc/permissions";
import { IpcTransport } from "../ipc/transport";
import { Operations } from "../operations/service";
import { PackageCatalog } from "../packages/catalog";
import { DlcResources } from "../packages/dlc-resources";
import { InstalledPackages } from "../packages/installed";
import { Packages } from "../packages/service";
import { PackageTransactions } from "../packages/transactions";
import { Backends } from "../processes/backends";
import { Processes } from "../processes/service";
import { SessionContext } from "../session/context";
import { Sessions } from "../session/service";
import { SettingsPanels } from "../settings/panels/service";
import { Settings } from "../settings/service";
import { GrantCatalog } from "../user/grant-catalog";
import { Users } from "../user/service";
import { Views } from "../views/service";

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
