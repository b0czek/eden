import type {
  AppInstance,
  ExecutionPrincipal,
  ProcessOwner,
  UserProfile,
} from "@edenapp/types";
import type * as Scope from "effect/Scope";
import type { PlatformUtilityProcess } from "../platform/ports";

export interface AppRuntime {
  owner: ProcessOwner;
  principal: ExecutionPrincipal;
  profile?: UserProfile;
}

export interface ProcessNamespaceEvents {
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
