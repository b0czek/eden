import * as Data from "effect/Data";
import { asError } from "../effects/io";
import type { FilesystemIoFailed } from "../filesystem/native-errors";
import type {
  StorageReadFailure,
  StorageRemoveFailure,
  StorageWriteFailure,
} from "../storage/errors";

export class UserAuthorityError extends Data.TaggedError("UserAuthorityError")<{
  readonly requirement: "vendor" | "active-session";
}> {
  override get message() {
    return this.requirement === "vendor"
      ? "Vendor account required"
      : "No active user session";
  }
}

export class UserNotFoundError extends Data.TaggedError("UserNotFoundError")<{
  readonly username: string;
}> {
  override get message() {
    return `User "${this.username}" not found`;
  }
}

export class UserAlreadyExistsError extends Data.TaggedError(
  "UserAlreadyExistsError",
)<{
  readonly username: string;
}> {
  override get message() {
    return `User "${this.username}" already exists`;
  }
}

export class VendorAccountPolicyError extends Data.TaggedError(
  "VendorAccountPolicyError",
)<{
  readonly action: "create" | "change-role" | "delete";
}> {
  override get message() {
    return {
      create: "Vendor account can only be seeded",
      "change-role": "Vendor role cannot be changed",
      delete: "Vendor account cannot be deleted",
    }[this.action];
  }
}

export class InvalidUserPasswordError extends Data.TaggedError(
  "InvalidUserPasswordError",
)<{
  readonly username: string;
  readonly purpose: "authenticate" | "change-password";
}> {
  override get message() {
    return this.purpose === "authenticate"
      ? "Invalid credentials"
      : "Invalid password";
  }
}

export class PasswordDerivationError extends Data.TaggedError(
  "PasswordDerivationError",
)<{
  readonly operation: "hash" | "verify";
  readonly cause: unknown;
}> {
  override get message() {
    return asError(this.cause).message;
  }
}

export class DirectoryRestrictionError extends Data.TaggedError(
  "DirectoryRestrictionError",
)<{
  readonly path: string;
  readonly message: string;
}> {}

export type UserRecordReadFailure = StorageReadFailure;
export type UserRecordSaveFailure = StorageReadFailure | StorageWriteFailure;
export type UserRecordDeleteFailure =
  | StorageReadFailure
  | StorageWriteFailure
  | StorageRemoveFailure;
export type UserDefaultWriteFailure =
  | StorageWriteFailure
  | StorageRemoveFailure;
export type UserDirectoryFailure =
  | DirectoryRestrictionError
  | FilesystemIoFailed;
export type CreateUserFailure =
  | UserRecordSaveFailure
  | UserAlreadyExistsError
  | VendorAccountPolicyError
  | PasswordDerivationError
  | UserDirectoryFailure;
export type UpdateUserFailure =
  | UserRecordSaveFailure
  | UserNotFoundError
  | VendorAccountPolicyError
  | UserDirectoryFailure;
export type DeleteUserFailure =
  | UserRecordDeleteFailure
  | UserNotFoundError
  | VendorAccountPolicyError;
export type SetPasswordFailure =
  | UserRecordSaveFailure
  | UserNotFoundError
  | PasswordDerivationError;
export type ChangePasswordFailure =
  | SetPasswordFailure
  | InvalidUserPasswordError;
export type AuthenticateUserFailure =
  | UserRecordReadFailure
  | UserNotFoundError
  | PasswordDerivationError
  | InvalidUserPasswordError;
export type SetDefaultUserFailure =
  | UserDefaultWriteFailure
  | UserRecordReadFailure
  | UserNotFoundError;
