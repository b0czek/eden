import * as Data from "effect/Data";

export class InvalidAppearanceConfig extends Data.TaggedError(
  "InvalidAppearanceConfig",
)<{
  readonly reason: string;
}> {
  override get message() {
    return `Invalid appearance configuration: ${this.reason}`;
  }
}

export class UnknownTheme extends Data.TaggedError("UnknownTheme")<{
  readonly themeId: string;
}> {
  override get message() {
    return `No theme has the ID "${this.themeId}"`;
  }
}
