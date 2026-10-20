import * as Data from "effect/Data";

export class DbInvalidValueError extends Data.TaggedError(
  "DbInvalidValueError",
)<{
  readonly appId: string;
  readonly key: string;
  readonly valueType: string;
}> {
  override get message() {
    return `Value must be a string, got ${this.valueType}`;
  }
}

export class DbCallerIdentityRequiredError extends Data.TaggedError(
  "DbCallerIdentityRequiredError",
)<Record<never, never>> {
  override get message() {
    return "Database access requires a caller app identity";
  }
}
