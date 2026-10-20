import type {
  AppAssociation,
  DaemonDefinition,
  DaemonStatus,
  PackageInfo as EdenPackageInfo,
  SessionChange as EdenSessionChange,
  FilesystemVolume,
  FilesystemVolumeRegistration,
  InstalledPackageInfo,
  InstalledPackageManifest,
  UserProfile,
  UserRole,
  WallpaperConfig,
  WallpaperPreset,
} from "@edenapp/types";
import type * as Effect from "effect/Effect";
import type { GenericSchema, ValiError } from "valibot";
import type { AppAssociationStorageWriteError } from "../app-associations/errors";
import type {
  DaemonDefinitionReadError,
  DaemonLaunchError,
  DaemonStopError,
  DaemonUpdateError,
} from "../daemon/errors";
import type {
  VolumeEjectError,
  VolumeRegistrationError,
} from "../filesystem/errors";
import type { HostOperationFailure } from "../operations/errors";
import type {
  PackageArchiveInstallError,
  PackageDevelopmentFailure,
  PackageRejected,
  PackageRemovalError,
} from "../packages/errors";
import type { LoginFailure, SessionTransitionFailure } from "../session/errors";
import type { SettingValueError } from "../settings/errors";
import type { StorageWriteFailure } from "../storage/errors";
import type {
  CreateUserFailure,
  DeleteUserFailure,
  SetDefaultUserFailure,
  SetPasswordFailure,
  UpdateUserFailure,
  UserRecordReadFailure,
} from "../user/errors";

export type EdenInputError = ValiError<GenericSchema>;
export type EdenDaemonOperationFailure =
  | EdenInputError
  | HostOperationFailure
  | DaemonLaunchError
  | DaemonStopError;

export type {
  PackageInfo as EdenPackageInfo,
  SessionChange as EdenSessionChange,
} from "@edenapp/types";

export type EdenUnsubscribe = () => void;

export type EdenLifecycleState =
  | "created"
  | "starting"
  | "ready"
  | "failed"
  | "stopping"
  | "stopped";

export interface EdenPackageListOptions {
  showHidden?: boolean;
  showRestricted?: boolean;
  kind?: "app" | "dlc";
  hostAppId?: string;
}

export type EdenPackageChange =
  | { type: "upserted"; manifest: InstalledPackageManifest }
  | { type: "uninstalled"; kind: "app"; packageId: string }
  | {
      type: "uninstalled";
      kind: "dlc";
      packageId: string;
      hostAppId: string;
    };

export interface EdenPackagesApi {
  list(options?: EdenPackageListOptions): InstalledPackageManifest[];
  get(packageId: string): InstalledPackageInfo | undefined;
  getIcon(packageId: string): Effect.Effect<string | undefined, EdenInputError>;
  getSize(packageId: string): Effect.Effect<number | undefined, EdenInputError>;
  inspect(sourcePath: string): Effect.Effect<EdenPackageInfo, EdenInputError>;
  install(
    sourcePath: string,
    options?: { replace?: boolean },
  ): Effect.Effect<
    InstalledPackageManifest,
    EdenInputError | HostOperationFailure | PackageArchiveInstallError
  >;
  uninstall(
    packageId: string,
  ): Effect.Effect<
    boolean,
    EdenInputError | HostOperationFailure | PackageRemovalError
  >;
  reload(
    packageId: string,
  ): Effect.Effect<void, EdenInputError | PackageDevelopmentFailure>;
  isHotReloadEnabled(
    packageId: string,
  ): Effect.Effect<boolean, EdenInputError | PackageRejected>;
  toggleHotReload(
    packageId: string,
  ): Effect.Effect<boolean, EdenInputError | PackageDevelopmentFailure>;
  onChanged(listener: (change: EdenPackageChange) => void): EdenUnsubscribe;
}

export interface EdenDaemonsApi {
  list(): Effect.Effect<
    DaemonStatus[],
    EdenInputError | DaemonDefinitionReadError
  >;
  updateDefinition(
    definition: DaemonDefinition,
  ): Effect.Effect<void, EdenInputError | DaemonUpdateError>;
  setEnabled(
    appId: string,
    enabled: boolean,
  ): Effect.Effect<
    void,
    EdenInputError | DaemonUpdateError | DaemonDefinitionReadError
  >;
  start(appId: string): Effect.Effect<void, EdenDaemonOperationFailure>;
  stop(appId: string): Effect.Effect<void, EdenDaemonOperationFailure>;
  restart(appId: string): Effect.Effect<void, EdenDaemonOperationFailure>;
  onChanged(listener: (status: DaemonStatus) => void): EdenUnsubscribe;
}

export interface EdenCreateUserInput {
  username?: string;
  name: string;
  role?: UserRole;
  password: string;
  grants?: string[];
  directoryRestriction?: string;
}

export interface EdenUpdateUserInput {
  username: string;
  name?: string;
  role?: UserRole;
  grants?: string[];
  directoryRestriction?: string | null;
}

export interface EdenUsersApi {
  list(): Effect.Effect<UserProfile[], EdenInputError | UserRecordReadFailure>;
  get(
    username: string,
  ): Effect.Effect<UserProfile | null, EdenInputError | UserRecordReadFailure>;
  create(
    input: EdenCreateUserInput,
  ): Effect.Effect<UserProfile, EdenInputError | CreateUserFailure>;
  update(
    input: EdenUpdateUserInput,
  ): Effect.Effect<UserProfile, EdenInputError | UpdateUserFailure>;
  delete(
    username: string,
  ): Effect.Effect<void, EdenInputError | DeleteUserFailure>;
  setPassword(
    username: string,
    password: string,
  ): Effect.Effect<void, EdenInputError | SetPasswordFailure>;
  getDefaultUsername(): string | null;
  setDefaultUsername(
    username: string | null,
  ): Effect.Effect<void, EdenInputError | SetDefaultUserFailure>;
}

export interface EdenSessionsApi {
  current(): UserProfile | null;
  login(
    username: string,
    password: string,
  ): Effect.Effect<
    UserProfile,
    EdenInputError | HostOperationFailure | LoginFailure
  >;
  logout(): Effect.Effect<
    void,
    EdenInputError | HostOperationFailure | SessionTransitionFailure
  >;
  onChanged(listener: (change: EdenSessionChange) => void): EdenUnsubscribe;
}

export interface EdenWallpaperPresets {
  solid: WallpaperPreset[];
  gradients: WallpaperPreset[];
}

export interface EdenAppearanceApi {
  getWallpaper(): Effect.Effect<WallpaperPreset, EdenInputError>;
  getPresets(): EdenWallpaperPresets;
  setWallpaper(
    config: WallpaperConfig,
  ): Effect.Effect<
    void,
    EdenInputError | StorageWriteFailure | SettingValueError
  >;
  onChanged(listener: (wallpaper: WallpaperPreset) => void): EdenUnsubscribe;
}

export interface EdenAssociationListOptions {
  kindPrefix?: string;
}

export interface EdenAssociationsApi {
  get(key: string): AppAssociation | undefined;
  list(options?: EdenAssociationListOptions): Record<string, AppAssociation>;
  set(
    key: string,
    association: AppAssociation,
  ): Effect.Effect<void, EdenInputError | AppAssociationStorageWriteError>;
  remove(
    key: string,
  ): Effect.Effect<void, EdenInputError | AppAssociationStorageWriteError>;
}

/** Host operations for a consumer-managed mounted directory. */
export interface EdenVolumeOptions {
  /** Volumes sharing this key drain and leave the runtime as one removal. */
  ejectGroup?: string;
  /** Resolve only after the OS has finished safely ejecting the device. */
  eject?: () => Effect.Effect<void, Error>;
}

export interface EdenVolumesApi {
  register(
    input: FilesystemVolumeRegistration,
    options?: EdenVolumeOptions,
  ): Effect.Effect<FilesystemVolume, EdenInputError | VolumeRegistrationError>;
  eject(
    id: string,
  ): Effect.Effect<
    void,
    EdenInputError | HostOperationFailure | VolumeEjectError
  >;
  unregister(id: string): boolean;
  list(): FilesystemVolume[];
  onChanged(listener: (volumes: FilesystemVolume[]) => void): EdenUnsubscribe;
}

/** Privileged host observation. Does not submit or cancel operations. */
export interface EdenOperationsObserver {
  get(
    handle: import("@edenapp/types").OperationHandle,
  ): import("@edenapp/types").OperationSnapshot | undefined;
  list(): import("@edenapp/types").OperationSnapshot[];
  onChanged(
    listener: (snapshot: import("@edenapp/types").OperationSnapshot) => void,
  ): EdenUnsubscribe;
}
