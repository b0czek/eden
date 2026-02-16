import type { DialogFormCheckboxField, DialogFormTextField } from "./types.js";

interface BaseFieldOptions {
  required?: boolean;
  disabled?: boolean;
  autofocus?: boolean;
  hint?: string;
}

interface TextFieldOptions extends BaseFieldOptions {
  placeholder?: string;
  initialValue?: string;
}

interface CheckboxFieldOptions extends BaseFieldOptions {
  initialValue?: boolean;
}

/** Creates a single-line text field config for `dialogs.form`. */
const text = <TKey extends string>(
  key: TKey,
  label: string,
  options: TextFieldOptions = {},
): DialogFormTextField<TKey> => ({
  kind: "text",
  key,
  label,
  placeholder: options.placeholder,
  initialValue: options.initialValue,
  required: options.required,
  disabled: options.disabled,
  autofocus: options.autofocus,
  hint: options.hint,
});

/** Creates an email field config for `dialogs.form`. */
const email = <TKey extends string>(
  key: TKey,
  label: string,
  options: TextFieldOptions = {},
): DialogFormTextField<TKey> => ({
  kind: "email",
  key,
  label,
  placeholder: options.placeholder,
  initialValue: options.initialValue,
  required: options.required,
  disabled: options.disabled,
  autofocus: options.autofocus,
  hint: options.hint,
});

/** Creates a password field config for `dialogs.form`. */
const password = <TKey extends string>(
  key: TKey,
  label: string,
  options: TextFieldOptions = {},
): DialogFormTextField<TKey> => ({
  kind: "password",
  key,
  label,
  placeholder: options.placeholder,
  initialValue: options.initialValue,
  required: options.required,
  disabled: options.disabled,
  autofocus: options.autofocus,
  hint: options.hint,
});

/** Creates a multiline textarea field config for `dialogs.form`. */
const textarea = <TKey extends string>(
  key: TKey,
  label: string,
  options: TextFieldOptions = {},
): DialogFormTextField<TKey> => ({
  kind: "textarea",
  key,
  label,
  placeholder: options.placeholder,
  initialValue: options.initialValue,
  required: options.required,
  disabled: options.disabled,
  autofocus: options.autofocus,
  hint: options.hint,
});

/** Creates a checkbox field config for `dialogs.form`. */
const checkbox = <TKey extends string>(
  key: TKey,
  label: string,
  options: CheckboxFieldOptions = {},
): DialogFormCheckboxField<TKey> => ({
  kind: "checkbox",
  key,
  label,
  initialValue: options.initialValue,
  required: options.required,
  disabled: options.disabled,
  autofocus: options.autofocus,
  hint: options.hint,
});

/** Declarative form field builders used with `dialogs.form({ fields: [...] })`. */
export const field = {
  text,
  email,
  password,
  textarea,
  checkbox,
};
