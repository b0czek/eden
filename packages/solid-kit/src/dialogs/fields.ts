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

export const field = {
  text,
  email,
  password,
  textarea,
  checkbox,
};
