import type {
  AppInstance,
  ExecutionPrincipal,
  FilesystemLocation,
  ProcessOwner,
  UserProfile,
} from "@edenapp/types";
import type * as Scope from "effect/Scope";
import type {
  Bounds,
  PlatformUtilityProcess,
} from "../../platform/ports/types";

export interface AppRuntime {
  owner: ProcessOwner;
  principal: ExecutionPrincipal;
  profile?: UserProfile;
}

export interface LaunchRequest {
  appId: string;
  runtime: AppRuntime;
  bounds?: Bounds;
  launchArgs?: string[];
  launchFile?: FilesystemLocation;
}

export interface ProcessEvents {
  launched: { instance: AppInstance };
  stopped: { appId: string };
  reloading: { appId: string };
  error: { appId: string; error: unknown };
  exited: { appId: string; code: number };
}
export interface InstanceRecord {
  appId: string;
  scope: Scope.Closeable;
  runtime: AppRuntime;
  instance?: AppInstance;
  backend?: PlatformUtilityProcess;
  closing: boolean;
}
