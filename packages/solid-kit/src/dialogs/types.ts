import type { Accessor, JSX, Setter } from "solid-js";

export type DialogSize = "sm" | "md" | "lg";
export type DialogTone = "default" | "danger";
export type DialogEnterBehavior = "submit" | "ignore";
export type DialogFormFieldKind =
  | "text"
  | "email"
  | "password"
  | "textarea"
  | "checkbox";

interface DialogBaseOptions {
  title: string;
  message?: JSX.Element | string;
  size?: DialogSize;
  dismissOnBackdrop?: boolean;
  dismissOnEscape?: boolean;
  onEnter?: DialogEnterBehavior;
  selectInitialFocusText?: boolean;
}

export interface CustomDialogRenderContext<TValue, TResult = TValue | null> {
  value: Accessor<TValue>;
  setValue: Setter<TValue>;
  canSubmit: Accessor<boolean>;
  setCanSubmit: Setter<boolean>;
  submit: (result?: TResult) => void;
  cancel: () => void;
  setPrimaryActionRef: (el: HTMLButtonElement | undefined) => void;
  setInitialFocusRef: (el: HTMLElement | undefined) => void;
}

export interface CustomDialogOptions<TValue, TResult = TValue | null>
  extends DialogBaseOptions {
  initialValue: TValue;
  initialCanSubmit?: boolean;
  render?: (ctx: CustomDialogRenderContext<TValue, TResult>) => JSX.Element;
  footer?: (ctx: CustomDialogRenderContext<TValue, TResult>) => JSX.Element;
  defaultSubmitResult?: TResult;
  cancelResult?: TResult;
}

export interface AlertDialogOptions extends DialogBaseOptions {
  okLabel?: string;
}

export interface ConfirmDialogOptions extends DialogBaseOptions {
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: DialogTone;
}

export interface PromptDialogOptions extends DialogBaseOptions {
  label?: string;
  placeholder?: string;
  hint?: JSX.Element | string;
  initialValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: DialogTone;
}

interface DialogFormFieldBase<TKey extends string = string> {
  key: TKey;
  kind: DialogFormFieldKind;
  label: string;
  hint?: JSX.Element | string;
  required?: boolean;
  disabled?: boolean;
  autofocus?: boolean;
}

export interface DialogFormTextField<TKey extends string = string>
  extends DialogFormFieldBase<TKey> {
  kind: "text" | "email" | "password" | "textarea";
  placeholder?: string;
  initialValue?: string;
}

export interface DialogFormCheckboxField<TKey extends string = string>
  extends DialogFormFieldBase<TKey> {
  kind: "checkbox";
  initialValue?: boolean;
}

export type DialogFormField<TKey extends string = string> =
  | DialogFormTextField<TKey>
  | DialogFormCheckboxField<TKey>;

export type DialogFormValue<TField extends DialogFormField = DialogFormField> =
  TField extends DialogFormCheckboxField ? boolean : string;

export type DialogFormValues<TFields extends readonly DialogFormField[]> = {
  [TField in TFields[number] as TField["key"]]: DialogFormValue<TField>;
};

export interface FormDialogOptions<TFields extends readonly DialogFormField[]>
  extends DialogBaseOptions {
  fields: TFields;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: DialogTone;
}

export interface DialogRequest<TValue = unknown, TResult = unknown> {
  id: number;
  title: string;
  message?: JSX.Element | string;
  size: DialogSize;
  dismissOnBackdrop: boolean;
  dismissOnEscape: boolean;
  onEnter: DialogEnterBehavior;
  selectInitialFocusText: boolean;
  value: Accessor<TValue>;
  setValue: Setter<TValue>;
  canSubmit: Accessor<boolean>;
  setCanSubmit: Setter<boolean>;
  render?: (ctx: CustomDialogRenderContext<TValue, TResult>) => JSX.Element;
  footer?: (ctx: CustomDialogRenderContext<TValue, TResult>) => JSX.Element;
  hasDefaultSubmitResult: boolean;
  defaultSubmitResult?: TResult;
  hasCancelResult: boolean;
  cancelResult?: TResult;
  resolve: (result: TResult) => void;
}

export interface DialogController {
  active: Accessor<DialogRequest | null>;
  submit: (result?: unknown) => void;
  cancel: () => void;
  custom: <TValue, TResult = TValue | null>(
    options: CustomDialogOptions<TValue, TResult>,
  ) => Promise<TResult>;
  alert: (options: AlertDialogOptions) => Promise<void>;
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>;
  prompt: (options: PromptDialogOptions) => Promise<string | null>;
  form: <TFields extends readonly DialogFormField[]>(
    options: FormDialogOptions<TFields>,
  ) => Promise<DialogFormValues<TFields> | null>;
}
