import * as Data from "effect/Data";

export class SettingValueError extends Data.TaggedError("SettingValueError")<{
  readonly appId: string;
  readonly key: string;
  readonly valueType: string;
}> {
  override get message() {
    return `Value must be a string, got ${this.valueType}`;
  }
}

export class SettingDefaultMissingError extends Data.TaggedError(
  "SettingDefaultMissingError",
)<{
  readonly appId: string;
  readonly key: string;
}> {
  override get message() {
    return `Cannot reset key "${this.key}": no default value found in schema`;
  }
}

/** Expected rejection from synchronous setting access checks. */
export class SettingAccessError extends Data.TaggedError("SettingAccessError")<{
  readonly appId: string;
  readonly key: string;
  readonly readerAppId?: string;
  readonly reason: "missing" | "reader" | "grant";
}> {
  override get message() {
    if (this.reason === "missing")
      return `Setting "${this.key}" does not exist for app "${this.appId}"`;
    if (this.reason === "reader")
      return "Caller is not allowed to read this setting";
    return "User does not have grant to access this setting";
  }
}

export class SettingsCallerIdentityError extends Data.TaggedError(
  "SettingsCallerIdentityError",
)<Record<never, never>> {
  override get message() {
    return "Settings access requires a caller app identity";
  }
}

export function settingAccessRejection(cause: unknown): SettingAccessError {
  if (cause instanceof SettingAccessError) return cause;
  throw cause;
}
