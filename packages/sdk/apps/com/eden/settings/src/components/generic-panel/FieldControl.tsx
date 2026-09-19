import type {
  SettingsPanelDialogField,
  SettingsPanelInputNode,
  SettingsPanelValue,
} from "@edenapp/types";
import {
  batch,
  createEffect,
  createSignal,
  For,
  Match,
  Switch,
} from "solid-js";
import { localized } from "./utils";

type Field = SettingsPanelDialogField | SettingsPanelInputNode;

interface FieldControlProps {
  field: Field;
  inputId: string;
  value: SettingsPanelValue | undefined;
  disabled?: boolean;
  onInput(value: SettingsPanelValue): unknown;
  deferCommit?: boolean;
}

export default function FieldControl(props: FieldControlProps) {
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
}
