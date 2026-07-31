import type {
  SettingsPanelControl,
  SettingsPanelDialog,
  SettingsPanelFormField,
  SettingsPanelInput,
  SettingsPanelLocalizedText,
  SettingsPanelValue,
} from "@edenapp/types";
import {
  type Accessor,
  batch,
  createEffect,
  createSignal,
  For,
  Show,
} from "solid-js";
import { getLocalizedValue, locale, t } from "../i18n";
import type { LoadedPanel, PanelAction } from "../types";

interface GenericPanelProps {
  panel: LoadedPanel;
  busyActions: Accessor<Set<string>>;
  onAction: PanelAction;
}

const localized = (value?: SettingsPanelLocalizedText) =>
  value ? getLocalizedValue(value, locale()) : "";

const badgeClass = (tone?: string) =>
  tone && tone !== "neutral" ? ` eden-badge-${tone}` : "";

const dialogFieldErrors = (fields: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(fields).map(([path, message]) => [
      path.startsWith("input.") ? path.slice("input.".length) : path,
      message,
    ]),
  );

const FieldControl = (props: {
  field: SettingsPanelFormField | SettingsPanelInput;
  inputId: string;
  value: SettingsPanelValue | undefined;
  disabled?: boolean;
  onInput: (value: SettingsPanelValue) => void;
  deferCommit?: boolean;
}) => {
  const inputType = () => ("input" in props.field ? props.field.input : "text");
  const [draft, setDraft] = createSignal<SettingsPanelValue>(props.value ?? "");
  const [dirty, setDirty] = createSignal(false);
  createEffect(() => {
    if (!dirty()) setDraft(props.value ?? "");
  });
  const value = () => (props.deferCommit ? draft() : (props.value ?? ""));
  const update = (next: SettingsPanelValue) => {
    if (!props.deferCommit) {
      props.onInput(next);
      return;
    }
    batch(() => {
      setDraft(next);
      setDirty(true);
    });
  };
  const parsed = (raw: string): SettingsPanelValue =>
    inputType() === "number" || inputType() === "range" ? Number(raw) : raw;
  const commit = (next = draft()) => {
    if (!props.deferCommit || !dirty()) return;
    setDirty(false);
    props.onInput(next);
  };

  if (inputType() === "select") {
    return (
      <select
        id={props.inputId}
        class="eden-select"
        disabled={props.disabled}
        value={String(value())}
        onChange={(event) => props.onInput(event.currentTarget.value)}
      >
        <For each={props.field.options ?? []}>
          {(option) => (
            <option value={option.value}>{localized(option.label)}</option>
          )}
        </For>
      </select>
    );
  }
  if (inputType() === "radio") {
    return (
      <div
        class="eden-radio-group"
        role="radiogroup"
        aria-labelledby={`${props.inputId}-label`}
      >
        <For each={props.field.options ?? []}>
          {(option) => (
            <label class="eden-radio-option">
              <input
                class="eden-radio"
                type="radio"
                name={props.field.id}
                disabled={props.disabled}
                checked={String(value()) === option.value}
                onChange={() => props.onInput(option.value)}
              />
              <span>{localized(option.label)}</span>
            </label>
          )}
        </For>
      </div>
    );
  }
  if (inputType() === "textarea") {
    return (
      <textarea
        id={props.inputId}
        class="eden-textarea"
        disabled={props.disabled}
        value={String(value())}
        placeholder={localized(props.field.placeholder)}
        onInput={(event) => update(event.currentTarget.value)}
        onBlur={(event) => commit(event.currentTarget.value)}
      />
    );
  }
  if (inputType() === "checkbox") {
    return (
      <input
        id={props.inputId}
        class="eden-checkbox"
        type="checkbox"
        disabled={props.disabled}
        checked={value() === true}
        onChange={(event) => props.onInput(event.currentTarget.checked)}
      />
    );
  }
  return (
    <input
      id={props.inputId}
      class="eden-input"
      type={inputType() === "password" ? "password" : inputType()}
      disabled={props.disabled}
      value={String(value())}
      min={props.field.validation?.min}
      max={props.field.validation?.max}
      step={props.field.validation?.step}
      minlength={props.field.validation?.minLength}
      maxlength={props.field.validation?.maxLength}
      pattern={props.field.validation?.pattern}
      required={props.field.validation?.required}
      autocomplete={
        "autocomplete" in props.field ? props.field.autocomplete : undefined
      }
      placeholder={localized(props.field.placeholder)}
      onInput={(event) => {
        const raw = event.currentTarget.value;
        update(parsed(raw));
      }}
      onChange={
        inputType() === "range" || inputType() === "color"
          ? (event) => commit(parsed(event.currentTarget.value))
          : undefined
      }
      onBlur={(event) => commit(parsed(event.currentTarget.value))}
    />
  );
};

const DialogControl = (props: {
  control: SettingsPanelDialog;
  busy: boolean;
  disabled: boolean;
  onAction: PanelAction;
}) => {
  const [open, setOpen] = createSignal(false);
  const [values, setValues] = createSignal<Record<string, SettingsPanelValue>>(
    {},
  );
  const [errors, setErrors] = createSignal<Record<string, string>>({});

  const clearSecrets = () => {
    setValues((current) => {
      const next = { ...current };
      for (const field of props.control.dialog.fields) {
        if (field.input === "password") next[field.id] = "";
      }
      return next;
    });
  };
  const close = () => {
    if (props.busy) return;
    setValues({});
    setErrors({});
    setOpen(false);
  };
  const setValue = (fieldId: string, value: SettingsPanelValue) => {
    setValues((current) => ({ ...current, [fieldId]: value }));
    if (errors()[fieldId]) {
      setErrors((current) => {
        const next = { ...current };
        delete next[fieldId];
        return next;
      });
    }
  };
  const validate = () => {
    const next: Record<string, string> = {};
    for (const field of props.control.dialog.fields) {
      const value = values()[field.id];
      const rules = field.validation;
      if (
        rules?.required &&
        (value === undefined || value === null || value === "")
      ) {
        next[field.id] = t("settings.validation.required");
      } else if (
        typeof value === "string" &&
        rules?.minLength !== undefined &&
        value.length < rules.minLength
      ) {
        next[field.id] = t("settings.validation.minLength", {
          count: rules.minLength,
        });
      } else if (
        typeof value === "string" &&
        rules?.maxLength !== undefined &&
        value.length > rules.maxLength
      ) {
        next[field.id] = t("settings.validation.maxLength", {
          count: rules.maxLength,
        });
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };
  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (!validate()) return;
    try {
      const input = { ...values() } as SettingsPanelValue;
      const result = await props.onAction(props.control.actionId, input);
      if (result.success) {
        setValues({});
        setErrors({});
        setOpen(false);
      } else if (result.error?.fields) {
        setErrors(dialogFieldErrors(result.error.fields));
      }
    } finally {
      clearSecrets();
    }
  };

  return (
    <>
      <button
        type="button"
        class="eden-btn eden-btn-secondary"
        disabled={props.busy || props.disabled}
        onClick={() => setOpen(true)}
      >
        {localized(props.control.buttonLabel)}
      </button>
      <Show when={open()}>
        <div class="eden-modal-overlay">
          <form
            class="eden-modal eden-modal-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${props.control.id}-dialog-title`}
            onSubmit={submit}
          >
            <div class="eden-modal-header">
              <h3
                id={`${props.control.id}-dialog-title`}
                class="eden-modal-title"
              >
                {localized(props.control.dialog.title)}
              </h3>
              <button
                type="button"
                class="eden-modal-close"
                aria-label={t("common.close")}
                disabled={props.busy}
                onClick={close}
              >
                ×
              </button>
            </div>
            <div class="eden-modal-body eden-flex-col eden-gap-md">
              <Show when={props.control.dialog.description}>
                {(description) => <p>{localized(description())}</p>}
              </Show>
              <For each={props.control.dialog.fields}>
                {(field) => {
                  const inputId = `${props.control.id}-${field.id}`;
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
                        value={values()[field.id]}
                        disabled={props.busy || props.disabled}
                        onInput={(value) => setValue(field.id, value)}
                      />
                      <Show when={field.description}>
                        {(description) => (
                          <span class="eden-text-sm eden-text-muted">
                            {localized(description())}
                          </span>
                        )}
                      </Show>
                      <Show when={errors()[field.id]}>
                        {(error) => <span class="field-error">{error()}</span>}
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
                {localized(props.control.dialog.cancelLabel)}
              </button>
              <button
                type="submit"
                class="eden-btn eden-btn-primary"
                disabled={props.busy || props.disabled}
              >
                {props.busy
                  ? t("settings.operationPending")
                  : localized(props.control.dialog.submitLabel)}
              </button>
            </div>
          </form>
        </div>
      </Show>
    </>
  );
};

export default function GenericPanel(props: GenericPanelProps) {
  const [optimistic, setOptimistic] = createSignal<
    Record<string, SettingsPanelValue>
  >({});
  const actionAuthorized = (control: SettingsPanelControl) =>
    !("actionId" in control) ||
    props.panel.declaration.actions.find(
      (action) => action.id === control.actionId,
    )?.authorized !== false;
  const state = (control: SettingsPanelControl) => {
    const key = "stateKey" in control ? control.stateKey : control.id;
    return (
      props.panel.state.controls?.[control.id] ??
      props.panel.state.controls?.[key]
    );
  };
  const value = (control: SettingsPanelControl) =>
    optimistic()[control.id] ?? state(control)?.value;
  const runValueAction = async (
    control: Extract<SettingsPanelControl, { actionId: string }>,
    next: SettingsPanelValue,
  ) => {
    setOptimistic((current) => ({ ...current, [control.id]: next }));
    try {
      await props.onAction(control.actionId, { value: next });
    } finally {
      setOptimistic((current) => {
        const copy = { ...current };
        delete copy[control.id];
        return copy;
      });
    }
  };

  return (
    <div class="settings-list">
      <Show
        when={props.panel.declaration.sections.length > 0}
        fallback={<div class="empty-state">{t("settings.emptyPanel")}</div>}
      >
        <For each={props.panel.declaration.sections}>
          {(section) => (
            <section class="panel-section">
              <Show when={section.title}>
                {(title) => (
                  <h2 class="category-header">{localized(title())}</h2>
                )}
              </Show>
              <Show when={section.description}>
                {(description) => (
                  <p class="content-description">{localized(description())}</p>
                )}
              </Show>
              <For each={section.controls}>
                {(control) => {
                  const busy = () =>
                    "actionId" in control &&
                    props.busyActions().has(control.actionId);
                  const disabled = () =>
                    state(control)?.disabled || !actionAuthorized(control);
                  const deferInputCommit = () =>
                    control.kind === "input" &&
                    ["text", "textarea", "number", "color", "range"].includes(
                      control.input,
                    );
                  return (
                    <Show when={!state(control)?.hidden}>
                      <div class="setting-item">
                        <div class="setting-info">
                          <h3 class="setting-label">
                            {localized(control.label)}
                          </h3>
                          <Show when={control.description}>
                            {(description) => (
                              <p class="setting-description">
                                {localized(description())}
                              </p>
                            )}
                          </Show>
                        </div>
                        <div class="setting-control">
                          <Show when={control.kind === "status"}>
                            <span>{String(value(control) ?? "")}</span>
                            <Show when={state(control)?.detail}>
                              {(detail) => (
                                <span class="eden-text-sm eden-text-muted">
                                  {localized(detail())}
                                </span>
                              )}
                            </Show>
                            <Show when={state(control)?.badge}>
                              {(badge) => (
                                <span
                                  class={`eden-badge${badgeClass(
                                    badge().tone,
                                  )}`}
                                >
                                  {localized(badge().label)}
                                </span>
                              )}
                            </Show>
                          </Show>
                          <Show when={control.kind === "toggle"}>
                            <input
                              class="eden-toggle"
                              type="checkbox"
                              checked={value(control) === true}
                              disabled={busy() || disabled()}
                              onChange={(event) =>
                                void runValueAction(
                                  control as Extract<
                                    SettingsPanelControl,
                                    { kind: "toggle" }
                                  >,
                                  event.currentTarget.checked,
                                )
                              }
                            />
                          </Show>
                          <Show when={control.kind === "input"}>
                            <FieldControl
                              field={control as SettingsPanelInput}
                              inputId={`control-${control.id}`}
                              value={value(control)}
                              disabled={
                                disabled() || (busy() && !deferInputCommit())
                              }
                              deferCommit={deferInputCommit()}
                              onInput={(next) =>
                                void runValueAction(
                                  control as Extract<
                                    SettingsPanelControl,
                                    { kind: "input" }
                                  >,
                                  next,
                                )
                              }
                            />
                          </Show>
                          <Show when={control.kind === "dialog"}>
                            <DialogControl
                              control={control as SettingsPanelDialog}
                              busy={busy()}
                              disabled={disabled()}
                              onAction={props.onAction}
                            />
                          </Show>
                          <Show when={control.kind === "button"}>
                            <button
                              type="button"
                              class={`eden-btn eden-btn-${
                                control.kind === "button" &&
                                control.tone === "danger"
                                  ? "danger"
                                  : "primary"
                              }`}
                              disabled={busy() || disabled()}
                              onClick={() => {
                                if (
                                  control.kind === "button" &&
                                  control.confirmation &&
                                  !confirm(localized(control.confirmation))
                                ) {
                                  return;
                                }
                                if (control.kind === "button") {
                                  void props.onAction(control.actionId);
                                }
                              }}
                            >
                              {busy()
                                ? t("settings.operationPending")
                                : localized(control.label)}
                            </button>
                          </Show>
                        </div>
                      </div>
                    </Show>
                  );
                }}
              </For>
            </section>
          )}
        </For>
      </Show>
    </div>
  );
}
