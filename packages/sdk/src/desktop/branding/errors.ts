import * as Data from "effect/Data";

export class InvalidBrandingName extends Data.TaggedError(
  "InvalidBrandingName",
)<{
  readonly configuredName: string | undefined;
}> {
  override get message() {
    return "branding.name must be a non-empty string";
  }
}
