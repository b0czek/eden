import type {
  AppAssociation,
  DaemonDefinition,
  DaemonStatus,
  InstalledPackageInfo,
  InstalledPackageManifest,
  UserProfile,
  UserRole,
  WallpaperConfig,
  WallpaperPreset,
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

export interface EdenPackageInfo {
  success: boolean;
  manifest?: import("@edenapp/types").PackageManifest;
  preview?: import("@edenapp/types").PackageOperationPreview;
  error?: string;
}

export interface EdenPackagesApi {
  list(options?: EdenPackageListOptions): InstalledPackageManifest[];
  get(packageId: string): InstalledPackageInfo | undefined;
  getIcon(packageId: string): Promise<string | undefined>;
  getSize(packageId: string): Promise<number | undefined>;
  inspect(sourcePath: string): Promise<EdenPackageInfo>;
  install(
    sourcePath: string,
    options?: { replace?: boolean },
  ): Promise<InstalledPackageManifest>;
  uninstall(packageId: string): Promise<boolean>;
  reload(packageId: string): Promise<void>;
  isHotReloadEnabled(packageId: string): Promise<boolean>;
  toggleHotReload(packageId: string): Promise<boolean>;
  onChanged(listener: (change: EdenPackageChange) => void): EdenUnsubscribe;
}

export interface EdenDaemonsApi {
  list(): Promise<DaemonStatus[]>;
  updateDefinition(definition: DaemonDefinition): Promise<void>;
  setEnabled(appId: string, enabled: boolean): Promise<void>;
  start(appId: string): Promise<void>;
  stop(appId: string): Promise<void>;
  restart(appId: string): Promise<void>;
  onChanged(listener: (status: DaemonStatus) => void): EdenUnsubscribe;
}

export interface EdenCreateUserInput {
  username?: string;
  name: string;
  role?: UserRole;
  password: string;
  grants?: string[];
  homeDirectory?: string;
}

export interface EdenUpdateUserInput {
  username: string;
  name?: string;
  role?: UserRole;
  grants?: string[];
  homeDirectory?: string | null;
}

export interface EdenUsersApi {
  list(): Promise<UserProfile[]>;
  get(username: string): Promise<UserProfile | null>;
  create(input: EdenCreateUserInput): Promise<UserProfile>;
  update(input: EdenUpdateUserInput): Promise<UserProfile>;
  delete(username: string): Promise<void>;
  setPassword(username: string, password: string): Promise<void>;
  getDefaultUsername(): string | null;
  setDefaultUsername(username: string | null): Promise<void>;
}

export interface EdenSessionChange {
  currentUser: UserProfile | null;
  previousUsername: string | null;
  reason: "login" | "logout" | "system";
}

export interface EdenSessionsApi {
  current(): UserProfile | null;
  login(username: string, password: string): Promise<UserProfile>;
  logout(): Promise<void>;
  onChanged(listener: (change: EdenSessionChange) => void): EdenUnsubscribe;
}

export interface EdenWallpaperPresets {
  solid: WallpaperPreset[];
  gradients: WallpaperPreset[];
}

export interface EdenAppearanceApi {
  getWallpaper(): Promise<WallpaperPreset>;
  getPresets(): EdenWallpaperPresets;
  setWallpaper(config: WallpaperConfig): Promise<void>;
  onChanged(listener: (wallpaper: WallpaperPreset) => void): EdenUnsubscribe;
}

export interface EdenAssociationListOptions {
  kindPrefix?: string;
}

export interface EdenAssociationsApi {
  get(key: string): AppAssociation | undefined;
  list(options?: EdenAssociationListOptions): Record<string, AppAssociation>;
  set(key: string, association: AppAssociation): Promise<void>;
  remove(key: string): Promise<void>;
}
