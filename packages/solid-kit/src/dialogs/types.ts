import type { Accessor, JSX, Setter } from "solid-js";

/** Dialog width preset used by the built-in modal container. */
export type DialogSize = "sm" | "md" | "lg";

/** Visual tone for primary/confirm actions. */
export type DialogTone = "default" | "danger";

/** Behavior of the Enter key when a dialog is focused. */
export type DialogEnterBehavior = "submit" | "ignore";

/** Supported field kinds for declarative `dialogs.form`. */
export type DialogFormFieldKind =
  | "text"
  | "email"
  | "password"
  | "textarea"
  | "checkbox";

interface DialogBaseOptions {
  /** Header title shown in the dialog. */
  title: string;
  /** Optional message/content rendered above custom body content. */
  message?: JSX.Element | string;
  /** Optional width preset. Defaults to `"sm"`. */
  size?: DialogSize;
  /** Close when clicking the backdrop. Defaults to `true`. */
  dismissOnBackdrop?: boolean;
  /** Close on Escape key. Defaults to `true`. */
  dismissOnEscape?: boolean;
  /** Enter key behavior. Defaults to `"submit"`. */
  onEnter?: DialogEnterBehavior;
  /** Select text after initial focus is applied (inputs/textareas). */
  selectInitialFocusText?: boolean;
}

/** Runtime context passed to `custom.render` and `custom.footer`. */
export interface CustomDialogRenderContext<TValue, TResult = TValue | null> {
  /** Current dialog value signal accessor. */
  value: Accessor<TValue>;
  /** Value signal setter. */
  setValue: Setter<TValue>;
  /** Whether submit action should be enabled. */
  canSubmit: Accessor<boolean>;
  /** Enable/disable submit action. */
  setCanSubmit: Setter<boolean>;
  /** Resolve dialog as confirmed (optionally with custom result). */
  submit: (result?: TResult) => void;
  /** Resolve dialog as cancelled. */
  cancel: () => void;
  /** Assign primary action button ref for default focus fallback. */
  setPrimaryActionRef: (el: HTMLButtonElement | undefined) => void;
  /** Assign initial focus target for this dialog. */
  setInitialFocusRef: (el: HTMLElement | undefined) => void;
}

/** Advanced low-level dialog options used by `dialogs.custom`. */
export interface CustomDialogOptions<TValue, TResult = TValue | null>
  extends DialogBaseOptions {
  /** Initial value backing this dialog instance. */
  initialValue: TValue;
  /** Initial submit availability. Defaults to `true`. */
  initialCanSubmit?: boolean;
  /** Custom body renderer. */
  render?: (ctx: CustomDialogRenderContext<TValue, TResult>) => JSX.Element;
  /** Custom footer renderer. */
  footer?: (ctx: CustomDialogRenderContext<TValue, TResult>) => JSX.Element;
  /** Default result used when `submit()` is called without an argument. */
  defaultSubmitResult?: TResult;
  /** Result returned when cancelled. Defaults to `null` if not set. */
  cancelResult?: TResult;
  /** Async submit gate to prevent close and optionally override result. */
  onSubmitAttempt?: (
    result: TResult,
  ) => Promise<DialogSubmitResult<TResult>> | DialogSubmitResult<TResult>;
}

/** Options for `dialogs.alert`. */
export interface AlertDialogOptions extends DialogBaseOptions {
  /** Label for the single confirmation button. */
  okLabel?: string;
}

/** Options for `dialogs.confirm`. */
export interface ConfirmDialogOptions extends DialogBaseOptions {
  /** Label for the confirm button. */
  confirmLabel?: string;
  /** Label for the cancel button. */
  cancelLabel?: string;
  /** Visual tone for the confirm button. */
  tone?: DialogTone;
}

/** Options for `dialogs.prompt`. */
export interface PromptDialogOptions extends DialogBaseOptions {
  /** Optional field label shown above the input. */
  label?: string;
  /** Input placeholder. */
  placeholder?: string;
  /** Optional helper text shown below the input. */
  hint?: JSX.Element | string;
  /** Initial input value. */
  initialValue?: string;
  /** Label for the confirm button. */
  confirmLabel?: string;
  /** Label for the cancel button. */
  cancelLabel?: string;
  /** Visual tone for the confirm button. */
  tone?: DialogTone;
}

interface DialogFormFieldBase<TKey extends string = string> {
  /** Field key used in returned values object. */
  key: TKey;
  kind: DialogFormFieldKind;
  /** Visible field label. */
  label: string;
  /** Optional helper text shown below the field. */
  hint?: JSX.Element | string;
  /** Whether this field must be filled before submit. */
  required?: boolean;
  /** Whether this field is disabled. */
  disabled?: boolean;
  /** Prefer this field for initial focus. */
  autofocus?: boolean;
}

/** Declarative text-like field configuration. */
export interface DialogFormTextField<TKey extends string = string>
  extends DialogFormFieldBase<TKey> {
  kind: "text" | "email" | "password" | "textarea";
  /** Placeholder for text-like controls. */
  placeholder?: string;
  /** Initial string value. */
  initialValue?: string;
}

/** Declarative checkbox field configuration. */
export interface DialogFormCheckboxField<TKey extends string = string>
  extends DialogFormFieldBase<TKey> {
  kind: "checkbox";
  /** Initial checked state. */
  initialValue?: boolean;
}

/** Union of all supported declarative form field configurations. */
export type DialogFormField<TKey extends string = string> =
  | DialogFormTextField<TKey>
  | DialogFormCheckboxField<TKey>;

/** Value type produced by a given form field declaration. */
export type DialogFormValue<TField extends DialogFormField = DialogFormField> =
  TField extends DialogFormCheckboxField ? boolean : string;

/** Strongly-typed values object returned by `dialogs.form`. */
export type DialogFormValues<TFields extends readonly DialogFormField[]> = {
  [TField in TFields[number] as TField["key"]]: DialogFormValue<TField>;
};

/** Options for `dialogs.form`. */
export interface FormDialogOptions<TFields extends readonly DialogFormField[]>
  extends DialogBaseOptions {
  /** Declarative list of fields rendered in order. */
  fields: TFields;
  /** Label for the confirm/submit button. */
  confirmLabel?: string;
  /** Label for the cancel button. */
  cancelLabel?: string;
  /** Visual tone for the confirm button. */
  tone?: DialogTone;
  /** Sync validation hook. Return text/JSX to block submit and show error. */
  validate?: (values: DialogFormValues<TFields>) => JSX.Element | string | null;
  /** Async submit hook. Return text/JSX to keep dialog open and show error. */
  onSubmit?: (
    values: DialogFormValues<TFields>,
  ) =>
    | Promise<JSX.Element | string | null | undefined>
    | JSX.Element
    | string
    | null
    | undefined;
}

/** Result contract for `custom.onSubmitAttempt`. */
export interface DialogSubmitResult<TResult = unknown> {
  /** Whether the dialog should close after submit attempt. */
  allowClose: boolean;
  /** Optional result override returned when closing is allowed. */
  result?: TResult;
}

/** Public dialogs controller returned by `createDialogs()`. */
export interface DialogController {
  /** Closes the currently active dialog, if any. */
  cancel: () => void;

  /** Advanced low-level API for custom dialog layout/behavior. */
  custom: <TValue, TResult = TValue | null>(
    options: CustomDialogOptions<TValue, TResult>,
  ) => Promise<TResult>;
  /** Shows an informational dialog with a single action. */
  alert: (options: AlertDialogOptions) => Promise<void>;
  /** Shows a confirm/cancel dialog and resolves to user choice. */
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>;
  /** Shows a single text-input dialog and resolves to value or `null`. */
  prompt: (options: PromptDialogOptions) => Promise<string | null>;
  /** Shows a declarative form dialog and resolves to values or `null`. */
  form: <TFields extends readonly DialogFormField[]>(
    options: FormDialogOptions<TFields>,
  ) => Promise<DialogFormValues<TFields> | null>;
}
