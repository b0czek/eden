import type { AppManifest } from "./AppManifest";

export type ProcessOwner =
  | { kind: "system" }
  | { kind: "session"; sessionId: string; username: string | null };

export type ExecutionPrincipal =
  | { kind: "system" }
  | { kind: "user"; username: string };

export interface AppInstance {
  /** App manifest */
  manifest: AppManifest;

  /** Unique instance ID */
  instanceId: string;

  /** Runtime lifetime owner. */
  owner: ProcessOwner;

  /** Eden authorization principal used by this process. */
  principal: ExecutionPrincipal;

  /** Installation path on disk */
  installPath: string;

  /** WebContentsView ID */
  viewId: number;

  /** Current state */
  state: "starting" | "running" | "paused" | "stopped" | "error";

  /** Installation timestamp */
  installedAt: Date;

  /** Last launched timestamp */
  lastLaunched?: Date;
}

export type DaemonRestartPolicy = "never" | "on-failure" | "always";

export interface DaemonDefinition {
  appId: string;
  enabled: boolean;
  runAs: { kind: "user"; username: string } | null;
  restart: DaemonRestartPolicy;
}

export type DaemonRuntimeState =
  | "inactive"
  | "starting"
  | "active"
  | "stopping"
  | "backoff"
  | "failed";

export interface DaemonStatus {
  appId: string;
  name: string | Record<string, string>;
  definition: DaemonDefinition;
  state: DaemonRuntimeState;
  restartRequired: boolean;
  instanceId?: string;
  restartCount: number;
  lastError?: string;
  nextRestartAt?: number;
}
