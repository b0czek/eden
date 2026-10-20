import * as Data from "effect/Data";
import { asError } from "../effects/io";
import type { ProcessLaunchError, ProcessStopError } from "../processes/errors";
import type { SettingValueError } from "../settings/errors";
import type {
  StorageReadFailure,
  StorageRemoveFailure,
  StorageWriteFailure,
} from "../storage/errors";
import type { UserRecordReadFailure } from "../user/errors";

export class DaemonAppRequiredError extends Data.TaggedError(
  "DaemonAppRequiredError",
)<{
  readonly appId: string;
}> {
  override get message() {
    return `App ${this.appId} is not a backend-only daemon`;
  }
}

export class DaemonPrincipalRequiredError extends Data.TaggedError(
  "DaemonPrincipalRequiredError",
)<{
  readonly appId: string;
}> {
  override get message() {
    return `Daemon ${this.appId} requires a runAs account`;
  }
}

export class DaemonPrincipalNotFoundError extends Data.TaggedError(
  "DaemonPrincipalNotFoundError",
)<{
  readonly appId: string;
  readonly username: string;
}> {
  override get message() {
    return `Daemon user ${this.username} does not exist`;
  }
}

export class DaemonVendorPrincipalError extends Data.TaggedError(
  "DaemonVendorPrincipalError",
)<{
  readonly appId: string;
  readonly username: string;
}> {
  override get message() {
    return "Only a vendor can assign a vendor daemon principal";
  }
}

export class DaemonDefinitionReadError extends Data.TaggedError(
  "DaemonDefinitionReadError",
)<{
  readonly appId?: string;
  readonly cause: StorageReadFailure;
}> {
  override get message() {
    return asError(this.cause).message;
  }
}

export class DaemonDefinitionWriteError extends Data.TaggedError(
  "DaemonDefinitionWriteError",
)<{
  readonly appId: string;
  readonly cause: StorageWriteFailure | SettingValueError;
}> {
  override get message() {
    return asError(this.cause).message;
  }
}

export class DaemonDefinitionRemoveError extends Data.TaggedError(
  "DaemonDefinitionRemoveError",
)<{
  readonly appId: string;
  readonly cause: StorageRemoveFailure;
}> {
  override get message() {
    return asError(this.cause).message;
  }
}

export type DaemonValidationError =
  | DaemonAppRequiredError
  | DaemonPrincipalRequiredError
  | DaemonPrincipalNotFoundError
  | UserRecordReadFailure;
export type DaemonLaunchError = DaemonValidationError | ProcessLaunchError;
export type DaemonStopError = DaemonAppRequiredError | ProcessStopError;
export type DaemonUpdateError =
  | DaemonValidationError
  | DaemonDefinitionWriteError;
