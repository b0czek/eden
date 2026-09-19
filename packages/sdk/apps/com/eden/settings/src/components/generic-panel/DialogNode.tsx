import type {
  SettingsPanelDialogField,
  SettingsPanelDialogNode,
  SettingsPanelValue,
} from "@edenapp/types";
import { FiX } from "solid-icons/fi";
import {
  batch,
  createEffect,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import { Portal } from "solid-js/web";
import { t } from "../../i18n";
import type { PanelAction } from "../../types";
import FieldControl from "./FieldControl";
import { localized, withParams } from "./utils";

interface DialogNodeProps {
  node: SettingsPanelDialogNode;
  path: string;
  disabled: boolean;
  busy: boolean;
  onAction: PanelAction;
}

const fieldErrors = (fields: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(fields).map(([path, message]) => [
      path.startsWith("fields.") ? path.slice(7) : path,
      message,
    ]),
  );

export default function DialogNode(props: DialogNodeProps) {
  const [open, setOpen] = createSignal(false);
  const [values, setValues] = createSignal<Record<string, SettingsPanelValue>>(
    {},
  );
  const [errors, setErrors] = createSignal<Record<string, string>>({});
  let fieldKinds = new Map<string, string>();
  const fieldValue = (field: SettingsPanelDialogField) =>
    fieldKinds.get(field.id) === field.input ? values()[field.id] : field.value;

  createEffect(() => {
    const fields = props.node.dialog.fields;
    if (!open()) return;

    const nextKinds = new Map(fields.map((field) => [field.id, field.input]));
    batch(() => {
      setValues((current) =>
        Object.fromEntries(
          fields.flatMap((field) => {
            const compatible = fieldKinds.get(field.id) === field.input;
            if (compatible && Object.hasOwn(current, field.id))
              return [[field.id, current[field.id]]];
            return field.input === "password" || field.value === undefined
              ? []
              : [[field.id, field.value]];
          }),
        ),
      );
      setErrors((current) =>
        Object.fromEntries(
          fields.flatMap((field) =>
            fieldKinds.get(field.id) === field.input && current[field.id]
              ? [[field.id, current[field.id]]]
              : [],
          ),
        ),
      );
      fieldKinds = nextKinds;
    });
  });

  const clearPasswords = () =>
    setValues((current) => {
      const next = { ...current };
      for (const field of props.node.dialog.fields)
        if (field.input === "password") delete next[field.id];
      return next;
    });
  onCleanup(() => setValues({}));
  const close = () => {
    if (props.busy) return;
    clearPasswords();
    setErrors({});
    setOpen(false);
  };
  const openDialog = () => {
    fieldKinds = new Map(
      props.node.dialog.fields.map((field) => [field.id, field.input]),
    );
    setValues(
      Object.fromEntries(
        props.node.dialog.fields.flatMap((field) =>
          field.input === "password" || field.value === undefined
            ? []
            : [[field.id, field.value]],
        ),
      ),
    );
    setErrors({});
    setOpen(true);
  };
  const readFields = (
    form: HTMLFormElement,
  ): Record<string, SettingsPanelValue> => {
    const data = new FormData(form);
    const fields: Record<string, SettingsPanelValue> = {};
    for (const field of props.node.dialog.fields) {
      if (field.input === "checkbox") {
        fields[field.id] = data.has(field.id);
        continue;
      }
      const raw = data.get(field.id);
      if (
        typeof raw !== "string" ||
        ((field.input === "number" || field.input === "range") && raw === "")
      )
        continue;
      fields[field.id] =
        field.input === "number" || field.input === "range" ? Number(raw) : raw;
    }
    return fields;
  };
  const validate = (valuesToValidate: Record<string, SettingsPanelValue>) => {
    const next: Record<string, string> = {};
    for (const field of props.node.dialog.fields) {
      const value = valuesToValidate[field.id];
      if (
        field.validation?.required &&
        (value === undefined || value === null || value === "")
      )
        next[field.id] = t("settings.validation.required");
      else if (
        typeof value === "string" &&
        field.validation?.minLength !== undefined &&
        value.length < field.validation.minLength
      )
        next[field.id] = t("settings.validation.minLength", {
          count: field.validation.minLength,
        });
      else if (
        typeof value === "string" &&
        field.validation?.maxLength !== undefined &&
        value.length > field.validation.maxLength
      )
        next[field.id] = t("settings.validation.maxLength", {
          count: field.validation.maxLength,
        });
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };
  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const fields = readFields(form);
    if (!validate(fields)) return;
    try {
      const result = await props.onAction(
        props.path,
        props.node.action.actionId,
        {
          ...withParams(props.node.action),
          ...(Object.keys(fields).length ? { fields } : {}),
        },
      );
      if (result.success) {
        setValues({});
        setErrors({});
        setOpen(false);
      } else if (result.error?.fields)
        setErrors(fieldErrors(result.error.fields));
    } finally {
      for (const password of form.querySelectorAll<HTMLInputElement>(
        'input[type="password"]',
      ))
        password.value = "";
      clearPasswords();
    }
  };

  return (
    <>
      <button
        type="button"
        class="eden-btn eden-btn-secondary"
        disabled={props.busy || props.disabled}
        onClick={openDialog}
      >
        {localized(props.node.buttonLabel)}
      </button>
      <Show when={open()}>
        <Portal>
          <div class="eden-modal-overlay">
            <form
              class="eden-modal eden-modal-sm"
              role="dialog"
              aria-modal="true"
              aria-labelledby={`${props.path}-title`}
              onSubmit={submit}
            >
              <div class="eden-modal-header">
                <h3 id={`${props.path}-title`} class="eden-modal-title">
                  {localized(props.node.dialog.title)}
                </h3>
                <button
                  type="button"
                  class="eden-modal-close"
                  aria-label={t("common.close")}
                  disabled={props.busy}
                  onClick={close}
                >
                  <FiX aria-hidden="true" />
                </button>
              </div>
              <div class="eden-modal-body eden-flex-col eden-gap-md">
                <Show when={props.node.dialog.description}>
                  {(description) => <p>{localized(description())}</p>}
                </Show>
                <For each={props.node.dialog.fields}>
                  {(field) => {
                    const inputId = `${props.path}-${field.id}`;
                    return (
                      <div class="eden-form-group">
                        <label
                          id={`${inputId}-label`}
                          class="eden-form-label"
                          for={inputId}
                        >
                          {localized(field.label)}
                        </label>
                        <FieldControl
                          field={field}
                          inputId={inputId}
                          value={fieldValue(field)}
                          disabled={props.busy || props.disabled}
                          onInput={(value) => {
                            fieldKinds.set(field.id, field.input);
                            setValues((current) => ({
                              ...current,
                              [field.id]: value,
                            }));
                            setErrors((current) => {
                              const next = { ...current };
                              delete next[field.id];
                              return next;
                            });
                          }}
                        />
                        <Show when={field.description}>
                          {(description) => (
                            <span class="eden-text-sm eden-text-muted">
                              {localized(description())}
                            </span>
                          )}
                        </Show>
                        <Show when={errors()[field.id]}>
                          {(error) => (
                            <span class="field-error">{error()}</span>
                          )}
                        </Show>
                      </div>
                    );
                  }}
                </For>
              </div>
              <div class="eden-modal-footer">
                <button
                  type="button"
                  class="eden-btn eden-btn-secondary"
                  disabled={props.busy}
                  onClick={close}
                >
                  {localized(props.node.dialog.cancelLabel)}
                </button>
                <button
                  type="submit"
                  class="eden-btn eden-btn-primary"
                  disabled={props.busy || props.disabled}
                >
                  {props.busy
                    ? t("settings.operationPending")
                    : localized(props.node.dialog.submitLabel)}
                </button>
              </div>
            </form>
          </div>
        </Portal>
      </Show>
    </>
  );
}
