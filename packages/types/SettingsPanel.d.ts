import type { UserProfile } from "./User";

/** Text that can be localized by the Settings renderer. */
export type SettingsPanelLocalizedText =
  | string
  | Readonly<Record<string, string>>;

/** JSON-compatible values accepted by panel state and action inputs. */
export type SettingsPanelValue =
  | string
  | number
  | boolean
  | null
  | SettingsPanelValue[]
  | { [key: string]: SettingsPanelValue };

export type SettingsPanelBadgeTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger";

/** Fully-qualified active-user grant required to discover a panel. */
export type SettingsPanelGrant = string;

/** Additional active-user grant required to invoke one panel action. */
export type SettingsPanelActionGrant = string;

export interface SettingsPanelBadge {
  label: SettingsPanelLocalizedText;
  tone?: SettingsPanelBadgeTone;
}

export interface SettingsPanelValidation {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  min?: number;
  max?: number;
  step?: number;
}

export interface SettingsPanelOption {
  value: string;
  label: SettingsPanelLocalizedText;
  description?: SettingsPanelLocalizedText;
}

export type SettingsPanelInputType =
  | "text"
  | "password"
  | "number"
  | "checkbox"
  | "radio"
  | "select"
  | "textarea"
  | "color"
  | "range";

export interface SettingsPanelFormField {
  id: string;
  label: SettingsPanelLocalizedText;
  description?: SettingsPanelLocalizedText;
  input: SettingsPanelInputType;
  placeholder?: SettingsPanelLocalizedText;
  options?: SettingsPanelOption[];
  validation?: SettingsPanelValidation;
  autocomplete?: string;
}

export interface SettingsPanelControlBase {
  id: string;
  label: SettingsPanelLocalizedText;
  description?: SettingsPanelLocalizedText;
}

export interface SettingsPanelStatusRow extends SettingsPanelControlBase {
  kind: "status";
  stateKey: string;
}

export interface SettingsPanelToggle extends SettingsPanelControlBase {
  kind: "toggle";
  stateKey: string;
  actionId: string;
}

export interface SettingsPanelButton extends SettingsPanelControlBase {
  kind: "button";
  actionId: string;
  tone?: SettingsPanelBadgeTone;
  confirmation?: SettingsPanelLocalizedText;
}

export interface SettingsPanelInput extends SettingsPanelControlBase {
  kind: "input";
  stateKey: string;
  actionId: string;
  input: SettingsPanelInputType;
  placeholder?: SettingsPanelLocalizedText;
  options?: SettingsPanelOption[];
  validation?: SettingsPanelValidation;
}

export interface SettingsPanelDialogContent {
  title: SettingsPanelLocalizedText;
  description?: SettingsPanelLocalizedText;
  fields: SettingsPanelFormField[];
  submitLabel: SettingsPanelLocalizedText;
  cancelLabel: SettingsPanelLocalizedText;
}

export interface SettingsPanelDialog extends SettingsPanelControlBase {
  kind: "dialog";
  actionId: string;
  buttonLabel: SettingsPanelLocalizedText;
  dialog: SettingsPanelDialogContent;
}

export type SettingsPanelControl =
  | SettingsPanelStatusRow
  | SettingsPanelToggle
  | SettingsPanelButton
  | SettingsPanelInput
  | SettingsPanelDialog;

export interface SettingsPanelSection {
  id: string;
  title?: SettingsPanelLocalizedText;
  description?: SettingsPanelLocalizedText;
  controls: SettingsPanelControl[];
}

export type SettingsPanelActionInputSchema =
  | {
      type: "string";
      required?: boolean;
      minLength?: number;
      maxLength?: number;
      pattern?: string;
      enum?: string[];
    }
  | {
      type: "number";
      required?: boolean;
      min?: number;
      max?: number;
      enum?: number[];
    }
  | { type: "boolean"; required?: boolean }
  | {
      type: "array";
      required?: boolean;
      items?: SettingsPanelActionInputSchema;
    }
  | {
      type: "object";
      required?: boolean;
      properties?: Record<string, SettingsPanelActionInputSchema>;
      additionalProperties?: boolean;
    }
  | { type: "any"; required?: boolean };

export interface SettingsPanelActionDefinition {
  id: string;
  label?: SettingsPanelLocalizedText;
  description?: SettingsPanelLocalizedText;
  /** An additional active-user grant required for this action. */
  grant?: SettingsPanelActionGrant;
  input?: SettingsPanelActionInputSchema;
}

/**
 * Serializable panel declaration. Callbacks belong in the separate provider.
 *
 * IDs beginning with `eden.` and `app.` are reserved by Eden.
 */
export interface SettingsPanelDefinition {
  id: string;
  title: SettingsPanelLocalizedText;
  description?: SettingsPanelLocalizedText;
  icon?: string;
  /** Active-user grant required before the panel can be discovered or loaded. */
  grant: SettingsPanelGrant;
  sections: SettingsPanelSection[];
  actions?: SettingsPanelActionDefinition[];
}

export interface SettingsPanelControlState {
  value?: SettingsPanelValue;
  detail?: SettingsPanelLocalizedText;
  badge?: SettingsPanelBadge;
  disabled?: boolean;
  hidden?: boolean;
}

export interface SettingsPanelState {
  controls?: Record<string, SettingsPanelControlState>;
  /** Renderer-specific, JSON-compatible state for Eden-owned custom views. */
  data?: SettingsPanelValue;
}

export interface SettingsPanelProviderContext {
  panelId: string;
  sessionId: string;
  user: UserProfile;
}

export type SettingsPanelLoader = (
  context: SettingsPanelProviderContext,
) => SettingsPanelState | Promise<SettingsPanelState>;

export type SettingsPanelActionHandler = (
  input: SettingsPanelValue | undefined,
  context: SettingsPanelProviderContext,
) => void | Promise<void>;

/** Trusted main-process callbacks for a registered panel. */
export interface SettingsPanelProvider {
  load: SettingsPanelLoader;
  actions?: Record<string, SettingsPanelActionHandler>;
}

export interface SettingsPanelRegistrationOptions {
  /** Whether the panel is initially included in the Settings catalog. */
  visible?: boolean;
}

export interface SettingsPanelRegistration {
  readonly panelId: string;
  setVisible(visible: boolean): void;
  unregister(): void;
}

export type SettingsPanelSource = "eden" | "application" | "host";

export interface SettingsPanelSummary {
  id: string;
  title: SettingsPanelLocalizedText;
  description?: SettingsPanelLocalizedText;
  icon?: string;
  source: SettingsPanelSource;
}

export interface SettingsPanelActionAuthorization {
  id: string;
  authorized: boolean;
}

export interface SettingsPanelDeclaration extends SettingsPanelSummary {
  sections: SettingsPanelSection[];
  actions: SettingsPanelActionAuthorization[];
  /** Eden-owned renderer ID. Third-party registrations always use `generic`. */
  renderer: "generic" | "appearance" | "apps" | "daemons";
}

export interface SettingsPanelError {
  code:
    | "authorization"
    | "not_found"
    | "validation"
    | "load_failed"
    | "action_failed"
    | "session_changed";
  message: string;
  fields?: Record<string, string>;
}

export interface SettingsPanelResponse {
  panel?: SettingsPanelDeclaration;
  state?: SettingsPanelState;
  error?: SettingsPanelError;
}

export interface SettingsPanelActionResponse {
  success: boolean;
  error?: SettingsPanelError;
}
