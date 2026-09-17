import type { UserProfile } from "./User";

export type SettingsPanelLocalizedText =
  | string
  | Readonly<Record<string, string>>;
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
export type SettingsPanelGrant = string;
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
  | SettingsPanelObjectInputSchema
  | { type: "any"; required?: boolean };

export interface SettingsPanelObjectInputSchema {
  type: "object";
  required?: boolean;
  properties?: Record<string, SettingsPanelActionInputSchema>;
  additionalProperties?: boolean;
}

export interface SettingsPanelActionDefinition {
  id: string;
  label?: SettingsPanelLocalizedText;
  description?: SettingsPanelLocalizedText;
  grant?: SettingsPanelActionGrant;
  params?: SettingsPanelObjectInputSchema;
  value?: SettingsPanelActionInputSchema;
  fields?: SettingsPanelObjectInputSchema;
}

/** Serializable metadata that remains stable for a registration's lifetime. */
export interface SettingsPanelDefinition {
  id: string;
  parentId?: string;
  title: SettingsPanelLocalizedText;
  description?: SettingsPanelLocalizedText;
  icon?: string;
  grant: SettingsPanelGrant;
  actions?: SettingsPanelActionDefinition[];
}

export interface SettingsPanelActionBinding {
  actionId: string;
  /** Public, client-visible parameters. Handlers must reauthorize resources. */
  params?: Record<string, SettingsPanelValue>;
}

export interface SettingsPanelActionInvocation {
  params?: Record<string, SettingsPanelValue>;
  value?: SettingsPanelValue;
  fields?: Record<string, SettingsPanelValue>;
}

interface SettingsPanelNodeBase {
  id: string;
  label: SettingsPanelLocalizedText;
  description?: SettingsPanelLocalizedText;
}
interface SettingsPanelInteractiveNode extends SettingsPanelNodeBase {
  action: SettingsPanelActionBinding;
  disabled?: boolean;
}

export interface SettingsPanelStatusNode extends SettingsPanelNodeBase {
  kind: "status";
  value?: SettingsPanelLocalizedText;
  detail?: SettingsPanelLocalizedText;
  badge?: SettingsPanelBadge;
}
export interface SettingsPanelToggleNode extends SettingsPanelInteractiveNode {
  kind: "toggle";
  value: boolean;
}
export interface SettingsPanelButtonNode extends SettingsPanelInteractiveNode {
  kind: "button";
  tone?: SettingsPanelBadgeTone;
  confirmation?: SettingsPanelLocalizedText;
}

interface SettingsPanelInputNodeBase extends SettingsPanelInteractiveNode {
  kind: "input";
  placeholder?: SettingsPanelLocalizedText;
  validation?: SettingsPanelValidation;
}
export interface SettingsPanelStringInputNode
  extends SettingsPanelInputNodeBase {
  input: "text" | "textarea" | "color";
  value: string;
}
export interface SettingsPanelChoiceInputNode
  extends SettingsPanelInputNodeBase {
  input: "select" | "radio";
  value: string;
  options: SettingsPanelOption[];
}
export interface SettingsPanelNumberInputNode
  extends SettingsPanelInputNodeBase {
  input: "number" | "range";
  value: number;
}
export interface SettingsPanelCheckboxInputNode
  extends SettingsPanelInputNodeBase {
  input: "checkbox";
  value: boolean;
}
export type SettingsPanelInputNode =
  | SettingsPanelStringInputNode
  | SettingsPanelChoiceInputNode
  | SettingsPanelNumberInputNode
  | SettingsPanelCheckboxInputNode;

interface SettingsPanelDialogFieldBase {
  id: string;
  label: SettingsPanelLocalizedText;
  description?: SettingsPanelLocalizedText;
  placeholder?: SettingsPanelLocalizedText;
  validation?: SettingsPanelValidation;
  autocomplete?: string;
}
export interface SettingsPanelStringDialogField
  extends SettingsPanelDialogFieldBase {
  input: "text" | "textarea" | "color";
  value?: string;
}
export interface SettingsPanelChoiceDialogField
  extends SettingsPanelDialogFieldBase {
  input: "select" | "radio";
  value?: string;
  options: SettingsPanelOption[];
}
export interface SettingsPanelNumberDialogField
  extends SettingsPanelDialogFieldBase {
  input: "number" | "range";
  value?: number;
}
export interface SettingsPanelCheckboxDialogField
  extends SettingsPanelDialogFieldBase {
  input: "checkbox";
  value?: boolean;
}
export interface SettingsPanelPasswordDialogField
  extends SettingsPanelDialogFieldBase {
  input: "password";
  value?: never;
}
export type SettingsPanelDialogField =
  | SettingsPanelStringDialogField
  | SettingsPanelChoiceDialogField
  | SettingsPanelNumberDialogField
  | SettingsPanelCheckboxDialogField
  | SettingsPanelPasswordDialogField;

export interface SettingsPanelDialogContent {
  title: SettingsPanelLocalizedText;
  description?: SettingsPanelLocalizedText;
  fields: SettingsPanelDialogField[];
  submitLabel: SettingsPanelLocalizedText;
  cancelLabel: SettingsPanelLocalizedText;
}
export interface SettingsPanelDialogNode extends SettingsPanelInteractiveNode {
  kind: "dialog";
  buttonLabel: SettingsPanelLocalizedText;
  dialog: SettingsPanelDialogContent;
}
export type SettingsPanelRowNode =
  | SettingsPanelStatusNode
  | SettingsPanelButtonNode
  | SettingsPanelToggleNode
  | SettingsPanelDialogNode;

export interface SettingsPanelCollectionItem {
  id: string;
  title: SettingsPanelLocalizedText;
  description?: SettingsPanelLocalizedText;
  detail?: SettingsPanelLocalizedText;
  badge?: SettingsPanelBadge;
  disabled?: boolean;
  nodes: SettingsPanelRowNode[];
}
export interface SettingsPanelCollectionNode extends SettingsPanelNodeBase {
  kind: "collection";
  emptyLabel?: SettingsPanelLocalizedText;
  items: SettingsPanelCollectionItem[];
}
export type SettingsPanelNode =
  | SettingsPanelStatusNode
  | SettingsPanelToggleNode
  | SettingsPanelButtonNode
  | SettingsPanelInputNode
  | SettingsPanelDialogNode
  | SettingsPanelCollectionNode;

export interface SettingsPanelSection {
  id: string;
  title?: SettingsPanelLocalizedText;
  description?: SettingsPanelLocalizedText;
  nodes: SettingsPanelNode[];
}
export interface SettingsPanelView {
  sections: SettingsPanelSection[];
}

export interface SettingsPanelProviderContext {
  panelId: string;
  sessionId: string;
  user: UserProfile;
}
export type SettingsPanelLoader = (
  context: SettingsPanelProviderContext,
) => SettingsPanelView | Promise<SettingsPanelView>;
export type SettingsPanelActionHandler = (
  invocation: SettingsPanelActionInvocation,
  context: SettingsPanelProviderContext,
) => void | Promise<void>;
export interface SettingsPanelProvider {
  load: SettingsPanelLoader;
  actions?: Record<string, SettingsPanelActionHandler>;
}

export interface SettingsPanelRegistrationOptions {
  visible?: boolean;
}
export interface SettingsPanelRegistration {
  readonly panelId: string;
  /** Reload the selected panel's complete resolved snapshot. */
  invalidate(): void;
  setVisible(visible: boolean): void;
  unregister(): void;
}

export type SettingsPanelSource = "eden" | "application" | "host";
export interface SettingsPanelSummary {
  id: string;
  parentId?: string;
  title: SettingsPanelLocalizedText;
  description?: SettingsPanelLocalizedText;
  icon?: string;
  source: SettingsPanelSource;
}
export interface SettingsPanelActionAuthorization {
  id: string;
  authorized: boolean;
}
interface SettingsPanelSnapshotBase extends SettingsPanelSummary {
  actions: SettingsPanelActionAuthorization[];
}
export interface SettingsPanelGenericSnapshot
  extends SettingsPanelSnapshotBase {
  renderer: "generic";
  view: SettingsPanelView;
}
export interface SettingsPanelAppearanceSnapshot
  extends SettingsPanelSnapshotBase {
  renderer: "appearance";
  data?: SettingsPanelValue;
}
export interface SettingsPanelAppsSnapshot extends SettingsPanelSnapshotBase {
  renderer: "apps";
  data?: SettingsPanelValue;
}
export interface SettingsPanelDaemonsSnapshot
  extends SettingsPanelSnapshotBase {
  renderer: "daemons";
  data?: SettingsPanelValue;
}
export type SettingsPanelCustomSnapshot =
  | SettingsPanelAppearanceSnapshot
  | SettingsPanelAppsSnapshot
  | SettingsPanelDaemonsSnapshot;
export type SettingsPanelSnapshot =
  | SettingsPanelGenericSnapshot
  | SettingsPanelCustomSnapshot;

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
  panel?: SettingsPanelSnapshot;
  error?: SettingsPanelError;
}
export interface SettingsPanelActionResponse {
  success: boolean;
  error?: SettingsPanelError;
}
