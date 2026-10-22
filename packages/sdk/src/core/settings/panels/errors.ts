import * as Data from "effect/Data";

/** Registration and registration-handle checks reject synchronously. */
export class SettingsPanelRegistrationError extends Data.TaggedError(
  "SettingsPanelRegistrationError",
)<{
  readonly panelId: string;
  readonly message: string;
}> {}

export class SettingsPanelValidationError extends Data.TaggedError(
  "SettingsPanelValidationError",
)<{
  readonly message: string;
}> {}

export class SettingsPanelViewValidationError extends Data.TaggedError(
  "SettingsPanelViewValidationError",
)<{
  readonly path: string;
}> {
  override get message() {
    return `Invalid settings panel view at ${this.path}`;
  }
}
