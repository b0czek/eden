import type {
  SettingsPanelActionBinding,
  SettingsPanelButtonNode,
  SettingsPanelCollectionNode,
  SettingsPanelDialogField,
  SettingsPanelDialogNode,
  SettingsPanelGenericSnapshot,
  SettingsPanelInputNode,
  SettingsPanelLocalizedText,
  SettingsPanelNode,
  SettingsPanelRowNode,
  SettingsPanelStatusNode,
  SettingsPanelToggleNode,
  SettingsPanelValue,
  SettingsPanelView,
} from "@edenapp/types";
import { FiX } from "solid-icons/fi";
import {
  type Accessor,
  batch,
  createEffect,
  createSignal,
  For,
  Match,
  onCleanup,
  Show,
  Switch,
} from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { Portal } from "solid-js/web";
import { getLocalizedValue, locale, t } from "../i18n";
import type { PanelAction } from "../types";

interface GenericPanelProps {
  panel: SettingsPanelGenericSnapshot;
  busyActions: Accessor<Set<string>>;
  onAction: PanelAction;
}

const localized = (value?: SettingsPanelLocalizedText) =>
  value ? getLocalizedValue(value, locale()) : "";
const badgeClass = (tone?: string) =>
  tone && tone !== "neutral" ? ` eden-badge-${tone}` : "";
const withParams = (binding: SettingsPanelActionBinding) =>
  binding.params === undefined ? {} : { params: binding.params };
const fieldErrors = (fields: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(fields).map(([path, message]) => [
      path.startsWith("fields.") ? path.slice(7) : path,
      message,
    ]),
  );

type Field = SettingsPanelDialogField | SettingsPanelInputNode;
const FieldControl = (props: {
  field: Field;
  inputId: string;
  value: SettingsPanelValue | undefined;
  disabled?: boolean;
  onInput(value: SettingsPanelValue): void | Promise<unknown>;
  deferCommit?: boolean;
}) => {
  const [draft, setDraft] = createSignal<SettingsPanelValue>(
    props.value ?? (props.field.input === "checkbox" ? false : ""),
  );
  const [dirty, setDirty] = createSignal(false);
  const [completed, setCompleted] = createSignal(0);
  createEffect(() => {
    if (!dirty())
      setDraft(props.value ?? (props.field.input === "checkbox" ? false : ""));
  });
  const value = () => (props.deferCommit ? draft() : props.value);
  // Reconciliation may retain the same value after the browser edits the DOM.
  // Write the property again when an action settles, even for unchanged values.
  const syncControl = (
    control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  ) => {
    createEffect(() => {
      completed();
      const current = value();
      if (control instanceof HTMLInputElement && control.type === "checkbox")
        control.checked = current === true;
      else if (control instanceof HTMLInputElement && control.type === "radio")
        control.checked = String(current ?? "") === control.value;
      else control.value = String(current ?? "");
    });
  };
  const submit = async (next: SettingsPanelValue) => {
    try {
      await props.onInput(next);
    } finally {
      setCompleted((count) => count + 1);
    }
  };
  const update = (next: SettingsPanelValue) => {
    if (!props.deferCommit) return void submit(next);
    batch(() => {
      setDraft(next);
      setDirty(true);
    });
  };
  const commit = (next = draft()) => {
    if (props.deferCommit && dirty()) {
      setDirty(false);
      void submit(next);
    }
  };
  const parse = (raw: string) =>
    props.field.input === "number" || props.field.input === "range"
      ? Number(raw)
      : raw;
  return (
    <Switch>
      <Match when={props.field.input === "select"}>
        <select
          ref={syncControl}
          id={props.inputId}
          name={props.field.id}
          class="eden-select"
          disabled={props.disabled}
          value={String(value() ?? "")}
          onChange={(event) => void submit(event.currentTarget.value)}
        >
          <For each={"options" in props.field ? props.field.options : []}>
            {(option) => (
              <option value={option.value}>{localized(option.label)}</option>
            )}
          </For>
        </select>
      </Match>
      <Match when={props.field.input === "radio"}>
        <div
          class="eden-radio-group"
          role="radiogroup"
          aria-labelledby={`${props.inputId}-label`}
        >
          <For each={"options" in props.field ? props.field.options : []}>
            {(option) => (
              <label class="eden-radio-option">
                <input
                  ref={syncControl}
                  class="eden-radio"
                  type="radio"
                  name={"kind" in props.field ? props.inputId : props.field.id}
                  value={option.value}
                  disabled={props.disabled}
                  checked={String(value() ?? "") === option.value}
                  onChange={() => void submit(option.value)}
                />
                <span>{localized(option.label)}</span>
              </label>
            )}
          </For>
        </div>
      </Match>
      <Match when={props.field.input === "textarea"}>
        <textarea
          ref={syncControl}
          id={props.inputId}
          name={props.field.id}
          class="eden-textarea"
          disabled={props.disabled}
          value={String(value() ?? "")}
          placeholder={localized(props.field.placeholder)}
          onInput={(event) => update(event.currentTarget.value)}
          onBlur={(event) => commit(event.currentTarget.value)}
        />
      </Match>
      <Match when={props.field.input === "checkbox"}>
        <input
          ref={syncControl}
          id={props.inputId}
          name={props.field.id}
          class="eden-checkbox"
          type="checkbox"
          disabled={props.disabled}
          checked={value() === true}
          onChange={(event) => void submit(event.currentTarget.checked)}
        />
      </Match>
      <Match when={true}>
        <input
          ref={syncControl}
          id={props.inputId}
          name={props.field.id}
          class="eden-input"
          type={
            props.field.input === "password" ? "password" : props.field.input
          }
          disabled={props.disabled}
          value={String(value() ?? "")}
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
          onInput={(event) => update(parse(event.currentTarget.value))}
          onChange={
            props.field.input === "range" || props.field.input === "color"
              ? (event) => commit(parse(event.currentTarget.value))
              : undefined
          }
          onBlur={(event) => commit(parse(event.currentTarget.value))}
        />
      </Match>
    </Switch>
  );
};

const DialogNode = (props: {
  node: SettingsPanelDialogNode;
  path: string;
  disabled: boolean;
  busy: boolean;
  onAction: PanelAction;
}) => {
  const [open, setOpen] = createSignal(false);
  const [values, setValues] = createSignal<Record<string, SettingsPanelValue>>(
    {},
  );
  const [errors, setErrors] = createSignal<Record<string, string>>({});
  let fieldKinds = new Map<string, string>();
  const fieldValue = (field: SettingsPanelDialogField) =>
    fieldKinds.get(field.id) === field.input ? values()[field.id] : field.value;
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
};

const StatusNode = (props: { node: SettingsPanelStatusNode }) => (
  <>
    <div class="setting-info">
      <h4 class="setting-label">{localized(props.node.label)}</h4>
      <Show when={props.node.description}>
        {(value) => <p class="setting-description">{localized(value())}</p>}
      </Show>
      <Show when={props.node.detail}>
        {(value) => (
          <p class="eden-text-sm eden-text-muted">{localized(value())}</p>
        )}
      </Show>
    </div>
    <div class="setting-value">
      <Show when={props.node.value}>
        {(value) => <span>{localized(value())}</span>}
      </Show>
      <Show when={props.node.badge}>
        {(value) => (
          <span class={`eden-badge${badgeClass(value().tone)}`}>
            {localized(value().label)}
          </span>
        )}
      </Show>
    </div>
  </>
);
const ButtonNode = (props: {
  node: SettingsPanelButtonNode;
  path: string;
  disabled: boolean;
  busy: boolean;
  onAction: PanelAction;
}) => (
  <>
    <div class="setting-info">
      <h4 class="setting-label">{localized(props.node.label)}</h4>
      <Show when={props.node.description}>
        {(value) => <p class="setting-description">{localized(value())}</p>}
      </Show>
    </div>
    <button
      type="button"
      class={`eden-btn ${props.node.tone === "danger" ? "eden-btn-danger" : "eden-btn-secondary"}`}
      disabled={props.disabled || props.busy}
      onClick={() => {
        if (
          !props.node.confirmation ||
          window.confirm(localized(props.node.confirmation))
        )
          void props.onAction(
            props.path,
            props.node.action.actionId,
            withParams(props.node.action),
          );
      }}
    >
      {localized(props.node.label)}
    </button>
  </>
);
const ToggleNode = (props: {
  node: SettingsPanelToggleNode;
  path: string;
  disabled: boolean;
  busy: boolean;
  onAction: PanelAction;
}) => (
  <>
    <label class="setting-info" for={`${props.path}-toggle`}>
      <h4 class="setting-label">{localized(props.node.label)}</h4>
      <Show when={props.node.description}>
        {(value) => <p class="setting-description">{localized(value())}</p>}
      </Show>
    </label>
    <input
      id={`${props.path}-toggle`}
      class="eden-toggle"
      type="checkbox"
      checked={props.node.value}
      disabled={props.disabled || props.busy}
      onChange={async (event) => {
        const control = event.currentTarget;
        try {
          await props.onAction(props.path, props.node.action.actionId, {
            ...withParams(props.node.action),
            value: control.checked,
          });
        } finally {
          control.checked = props.node.value;
        }
      }}
    />
  </>
);
const InputNode = (props: {
  node: SettingsPanelInputNode;
  path: string;
  disabled: boolean;
  busy: boolean;
  onAction: PanelAction;
}) => (
  <>
    <div class="setting-info">
      <label
        id={`${props.path}-label`}
        class="setting-label"
        for={`${props.path}-input`}
      >
        {localized(props.node.label)}
      </label>
      <Show when={props.node.description}>
        {(value) => <p class="setting-description">{localized(value())}</p>}
      </Show>
    </div>
    <FieldControl
      field={props.node}
      inputId={`${props.path}-input`}
      value={props.node.value}
      disabled={props.disabled || props.busy}
      deferCommit={
        props.node.input !== "checkbox" &&
        props.node.input !== "select" &&
        props.node.input !== "radio"
      }
      onInput={(value) =>
        props.onAction(props.path, props.node.action.actionId, {
          ...withParams(props.node.action),
          value,
        })
      }
    />
  </>
);

const NodeByKind = (props: {
  node: SettingsPanelNode | SettingsPanelRowNode;
  path: string;
  inheritedDisabled?: boolean;
  busyActions: Accessor<Set<string>>;
  onAction: PanelAction;
}) => {
  const busy = () => props.busyActions().has(props.path);
  const disabled = () =>
    props.inheritedDisabled === true ||
    ("disabled" in props.node && props.node.disabled === true);
  switch (props.node.kind) {
    case "status":
      return <StatusNode node={props.node} />;
    case "button":
      return (
        <ButtonNode
          node={props.node}
          path={props.path}
          busy={busy()}
          disabled={disabled()}
          onAction={props.onAction}
        />
      );
    case "toggle":
      return (
        <ToggleNode
          node={props.node}
          path={props.path}
          busy={busy()}
          disabled={disabled()}
          onAction={props.onAction}
        />
      );
    case "input":
      return (
        <InputNode
          node={props.node}
          path={props.path}
          busy={busy()}
          disabled={disabled()}
          onAction={props.onAction}
        />
      );
    case "dialog":
      return (
        <DialogNode
          node={props.node}
          path={props.path}
          busy={busy()}
          disabled={disabled()}
          onAction={props.onAction}
        />
      );
    case "collection":
      return null;
  }
};

const ResolvedNode = (props: Parameters<typeof NodeByKind>[0]) => (
  <Show
    when={
      props.node.kind === "input"
        ? `input:${props.node.input}`
        : props.node.kind
    }
    keyed
  >
    {(_kind) => <NodeByKind {...props} />}
  </Show>
);

const CollectionNode = (props: {
  node: SettingsPanelCollectionNode;
  path: string;
  busyActions: Accessor<Set<string>>;
  onAction: PanelAction;
}) => (
  <div class="settings-collection">
    <Show
      when={props.node.items.length}
      fallback={
        <p class="settings-collection-empty">
          {localized(props.node.emptyLabel) || t("settings.emptyPanel")}
        </p>
      }
    >
      <For each={props.node.items}>
        {(item) => (
          <div class="settings-collection-item">
            <div class="setting-info">
              <div class="settings-collection-heading">
                <h4 class="setting-label">{localized(item.title)}</h4>
                <Show when={item.badge}>
                  {(value) => (
                    <span class={`eden-badge${badgeClass(value().tone)}`}>
                      {localized(value().label)}
                    </span>
                  )}
                </Show>
              </div>
              <Show when={item.description}>
                {(value) => (
                  <p class="setting-description">{localized(value())}</p>
                )}
              </Show>
              <Show when={item.detail}>
                {(value) => (
                  <p class="eden-text-sm eden-text-muted">
                    {localized(value())}
                  </p>
                )}
              </Show>
            </div>
            <div class="settings-collection-actions">
              <For each={item.nodes}>
                {(node) => (
                  <div class="settings-row-node">
                    <ResolvedNode
                      node={node}
                      path={`${props.path}/item:${item.id}/node:${node.id}`}
                      inheritedDisabled={item.disabled}
                      busyActions={props.busyActions}
                      onAction={props.onAction}
                    />
                  </div>
                )}
              </For>
            </div>
          </div>
        )}
      </For>
    </Show>
  </div>
);

export default function GenericPanel(props: GenericPanelProps) {
  const [store, setStore] = createStore<SettingsPanelView>({ sections: [] });
  createEffect(() => setStore(reconcile(props.panel.view, { key: "id" })));
  return (
    <div class="settings-list">
      <Show
        when={store.sections.length}
        fallback={<div class="empty-state">{t("settings.emptyPanel")}</div>}
      >
        <For each={store.sections}>
          {(section) => (
            <section class="settings-section">
              <Show when={section.title}>
                <h2 class="settings-section-title">
                  {localized(section.title)}
                </h2>
              </Show>
              <Show when={section.description}>
                {(value) => (
                  <p class="settings-section-description">
                    {localized(value())}
                  </p>
                )}
              </Show>
              <div class="settings-section-card">
                <For each={section.nodes}>
                  {(node) => (
                    <div
                      class={`setting-row${node.kind === "collection" ? " setting-row-collection" : ""}`}
                    >
                      {node.kind === "collection" ? (
                        <CollectionNode
                          node={node}
                          path={`section:${section.id}/node:${node.id}`}
                          busyActions={props.busyActions}
                          onAction={props.onAction}
                        />
                      ) : (
                        <ResolvedNode
                          node={node}
                          path={`section:${section.id}/node:${node.id}`}
                          busyActions={props.busyActions}
                          onAction={props.onAction}
                        />
                      )}
                    </div>
                  )}
                </For>
              </div>
            </section>
          )}
        </For>
      </Show>
    </div>
  );
}
