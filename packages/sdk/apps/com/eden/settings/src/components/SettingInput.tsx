import { Component, Show, For } from "solid-js";
import type { SettingDefinition } from "@edenapp/types";
import { getLocalizedValue, locale } from "../i18n";

interface SettingInputProps {
  setting: SettingDefinition;
  value: string;
  onChange: (value: string) => void;
}

const SettingInput: Component<SettingInputProps> = (props) => {
  const handleCheckbox = (e: Event) => {
    const target = e.target as HTMLInputElement;
    props.onChange(target.checked ? "true" : "false");
  };

  const handleInput = (e: Event) => {
    const target = e.target as
      | HTMLInputElement
      | HTMLTextAreaElement
      | HTMLSelectElement;
    props.onChange(target.value);
  };

  const label = () => getLocalizedValue(props.setting.label, locale());
  const description = () =>
    props.setting.description
      ? getLocalizedValue(props.setting.description, locale())
      : undefined;

  return (
    <div class="setting-item">
      <div class="setting-info">
        <h4 class="setting-label">{label()}</h4>
        <Show when={description()}>
          <p class="setting-description">{description()}</p>
        </Show>
      </div>
      <div class="setting-control">
        {/* Toggle */}
        <Show when={props.setting.type === "toggle"}>
          <input
            type="checkbox"
            class="eden-toggle"
            checked={props.value === "true"}
            onChange={handleCheckbox}
          />
        </Show>

        {/* Checkbox */}
        <Show when={props.setting.type === "checkbox"}>
          <input
            type="checkbox"
            class="eden-checkbox"
            checked={props.value === "true"}
            onChange={handleCheckbox}
          />
        </Show>

        {/* Select */}
        <Show when={props.setting.type === "select"}>
          <select
            class="eden-select"
            value={props.value}
            onChange={handleInput}
            style={{ "min-width": "160px" }}
          >
            <For each={props.setting.options}>
              {(option) => (
                <option
                  value={option.value}
                  selected={option.value === props.value}
                >
                  {getLocalizedValue(option.label, locale())}
                </option>
              )}
            </For>
          </select>
        </Show>

        {/* Radio */}
        <Show when={props.setting.type === "radio"}>
          <div class="eden-radio-group">
            <For each={props.setting.options}>
              {(option) => (
                <label class="eden-radio-option">
                  <input
                    type="radio"
                    class="eden-radio"
                    name={props.setting.key}
                    value={option.value}
                    checked={props.value === option.value}
                    onChange={handleInput}
                  />
                  <span class="eden-radio-option-label">
                    {getLocalizedValue(option.label, locale())}
                  </span>
                </label>
              )}
            </For>
          </div>
        </Show>

        {/* Text Input */}
        <Show when={props.setting.type === "text"}>
          <input
            type="text"
            class="eden-input"
            value={props.value}
            placeholder={props.setting.placeholder}
            onInput={handleInput}
            style={{ "min-width": "200px" }}
          />
        </Show>

        {/* Number Input */}
        <Show when={props.setting.type === "number"}>
          <input
            type="number"
            class="eden-input"
            value={props.value}
            min={props.setting.min}
            max={props.setting.max}
            step={props.setting.step}
            onInput={handleInput}
            style={{ width: "100px" }}
          />
        </Show>

        {/* Textarea */}
        <Show when={props.setting.type === "textarea"}>
          <textarea
            class="eden-textarea"
            value={props.value}
            placeholder={props.setting.placeholder}
            onInput={handleInput}
            rows={3}
            style={{ "min-width": "300px" }}
          />
        </Show>

        {/* Range Slider */}
        <Show when={props.setting.type === "range"}>
          <div class="eden-range">
            <input
              type="range"
              value={props.value}
              min={props.setting.min ?? 0}
              max={props.setting.max ?? 100}
              step={props.setting.step ?? 1}
              onInput={handleInput}
            />
            <span class="eden-range-value">{props.value}</span>
          </div>
        </Show>
      </div>
    </div>
  );
};

export default SettingInput;
