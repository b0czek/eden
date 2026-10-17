import type {
  AppAssociation,
  DaemonDefinition,
  DaemonStatus,
  FilesystemVolume,
  FilesystemVolumeRegistration,
  InstalledPackageInfo,
  InstalledPackageManifest,
  PackageManifest,
  PackageOperationPreview,
  UserProfile,
  UserRole,
  WallpaperConfig,
  WallpaperPreset,
} from "@edenapp/types";
import type * as Effect from "effect/Effect";

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

export interface EdenPackageInfo {
  success: boolean;
  manifest?: PackageManifest;
  preview?: PackageOperationPreview;
  error?: string;
}

export interface EdenPackagesApi {
  list(options?: EdenPackageListOptions): InstalledPackageManifest[];
  get(packageId: string): InstalledPackageInfo | undefined;
  getIcon(packageId: string): Effect.Effect<string | undefined, Error>;
  getSize(packageId: string): Effect.Effect<number | undefined, Error>;
  inspect(sourcePath: string): Effect.Effect<EdenPackageInfo, Error>;
  install(
    sourcePath: string,
    options?: { replace?: boolean },
  ): Effect.Effect<InstalledPackageManifest, Error>;
  uninstall(packageId: string): Effect.Effect<boolean, Error>;
  reload(packageId: string): Effect.Effect<void, Error>;
  isHotReloadEnabled(packageId: string): Effect.Effect<boolean, Error>;
  toggleHotReload(packageId: string): Effect.Effect<boolean, Error>;
  onChanged(listener: (change: EdenPackageChange) => void): EdenUnsubscribe;
}

export interface EdenDaemonsApi {
  list(): Effect.Effect<DaemonStatus[], Error>;
  updateDefinition(definition: DaemonDefinition): Effect.Effect<void, Error>;
  setEnabled(appId: string, enabled: boolean): Effect.Effect<void, Error>;
  start(appId: string): Effect.Effect<void, Error>;
  stop(appId: string): Effect.Effect<void, Error>;
  restart(appId: string): Effect.Effect<void, Error>;
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
  list(): Effect.Effect<UserProfile[], Error>;
  get(username: string): Effect.Effect<UserProfile | null, Error>;
  create(input: EdenCreateUserInput): Effect.Effect<UserProfile, Error>;
  update(input: EdenUpdateUserInput): Effect.Effect<UserProfile, Error>;
  delete(username: string): Effect.Effect<void, Error>;
  setPassword(username: string, password: string): Effect.Effect<void, Error>;
  getDefaultUsername(): string | null;
  setDefaultUsername(username: string | null): Effect.Effect<void, Error>;
}

export interface EdenSessionChange {
  currentUser: UserProfile | null;
  previousUsername: string | null;
  reason: "login" | "logout" | "system";
}

export interface EdenSessionsApi {
  current(): UserProfile | null;
  login(username: string, password: string): Effect.Effect<UserProfile, Error>;
  logout(): Effect.Effect<void, Error>;
  onChanged(listener: (change: EdenSessionChange) => void): EdenUnsubscribe;
}

export interface EdenWallpaperPresets {
  solid: WallpaperPreset[];
  gradients: WallpaperPreset[];
}

export interface EdenAppearanceApi {
  getWallpaper(): Effect.Effect<WallpaperPreset, Error>;
  getPresets(): EdenWallpaperPresets;
  setWallpaper(config: WallpaperConfig): Effect.Effect<void, Error>;
  onChanged(listener: (wallpaper: WallpaperPreset) => void): EdenUnsubscribe;
}

export interface EdenAssociationListOptions {
  kindPrefix?: string;
}

export interface EdenAssociationsApi {
  get(key: string): AppAssociation | undefined;
  list(options?: EdenAssociationListOptions): Record<string, AppAssociation>;
  set(key: string, association: AppAssociation): Effect.Effect<void, Error>;
  remove(key: string): Effect.Effect<void, Error>;
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
  ): Effect.Effect<FilesystemVolume, Error>;
  eject(id: string): Effect.Effect<void, Error>;
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
