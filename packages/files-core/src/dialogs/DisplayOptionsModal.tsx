import {
  FaSolidArrowDown,
  FaSolidArrowUp,
  FaSolidGrip,
  FaSolidList,
} from "solid-icons/fa";
import type { Component } from "solid-js";
import { Show } from "solid-js";
import { ITEM_SIZES } from "../constants";
import type { DisplayPreferences, FileExplorerLabels, SortBy } from "../types";

interface DisplayOptionsModalProps {
  labels: FileExplorerLabels;
  show: boolean;
  preferences: DisplayPreferences;
  onClose: () => void;
  onChange: (preferences: DisplayPreferences) => void;
}

const DisplayOptionsModal: Component<DisplayOptionsModalProps> = (props) => {
  const updatePreference = <K extends keyof DisplayPreferences>(
    key: K,
    value: DisplayPreferences[K],
  ) => {
    props.onChange({
      ...props.preferences,
      [key]: value,
    });
  };

  const getSizeValue = () => {
    return ITEM_SIZES.indexOf(props.preferences.itemSize);
  };

  const handleSizeChange = (value: number) => {
    updatePreference("itemSize", ITEM_SIZES[value]);
  };

  return (
    <Show when={props.show}>
      <div class="eden-modal-overlay display-options-position">
        <button
          type="button"
          class="display-options-backdrop"
          aria-label={props.labels.close}
          onClick={props.onClose}
        />
        <div
          class="eden-popover display-options-popover"
          role="dialog"
          aria-modal="true"
          aria-label={props.labels.displayOptions}
        >
          <div class="eden-flex-between eden-gap-md">
            <h3 class="eden-popover-title">{props.labels.displayOptions}</h3>
            <button
              type="button"
              class="eden-modal-close"
              onClick={props.onClose}
              aria-label={props.labels.close}
            >
              ×
            </button>
          </div>

          <div
            class="eden-flex-col"
            style={{ "margin-top": "var(--eden-space-lg)" }}
          >
            {/* View Style Section */}
            <fieldset class="eden-form-group display-options-fieldset">
              <legend class="eden-form-label">{props.labels.viewStyle}</legend>
              <div class="eden-btn-group">
                <button
                  type="button"
                  class="eden-btn eden-btn-md"
                  classList={{
                    "eden-btn-primary": props.preferences.viewStyle === "grid",
                  }}
                  onClick={() => updatePreference("viewStyle", "grid")}
                >
                  <FaSolidGrip /> {props.labels.grid}
                </button>
                <button
                  type="button"
                  class="eden-btn eden-btn-md"
                  classList={{
                    "eden-btn-primary": props.preferences.viewStyle === "list",
                  }}
                  onClick={() => updatePreference("viewStyle", "list")}
                >
                  <FaSolidList /> {props.labels.list}
                </button>
              </div>
            </fieldset>

            {/* Item Size Section */}
            <div class="eden-form-group">
              <label class="eden-form-label" for="display-item-size">
                {props.labels.displaySize}:{" "}
                <span class="eden-badge">
                  {props.labels[props.preferences.itemSize]}
                </span>
              </label>
              <div
                class="eden-flex eden-gap-md"
                style={{ "align-items": "center" }}
              >
                <span class="eden-text-xs eden-text-muted">
                  {props.labels.tiny}
                </span>
                <input
                  id="display-item-size"
                  type="range"
                  min="0"
                  max="4"
                  step="1"
                  value={getSizeValue()}
                  onInput={(e) =>
                    handleSizeChange(parseInt(e.currentTarget.value, 10))
                  }
                  class="eden-slider"
                />
                <span class="eden-text-xs eden-text-muted">
                  {props.labels.huge}
                </span>
              </div>
            </div>

            {/* Sort Options Section */}
            <div class="eden-form-group">
              <label class="eden-form-label" for="display-sort-by">
                {props.labels.sortBy}
              </label>
              <div class="eden-flex eden-gap-sm">
                <select
                  id="display-sort-by"
                  class="eden-select"
                  value={props.preferences.sortBy}
                  onChange={(e) =>
                    updatePreference("sortBy", e.currentTarget.value as SortBy)
                  }
                  style={{ flex: "1" }}
                >
                  <option value="name">{props.labels.name}</option>
                  <option value="size">{props.labels.size}</option>
                  <option value="modified">{props.labels.modified}</option>
                </select>

                <button
                  type="button"
                  class="eden-btn eden-btn-sm eden-btn-square"
                  onClick={() =>
                    updatePreference(
                      "sortOrder",
                      props.preferences.sortOrder === "asc" ? "desc" : "asc",
                    )
                  }
                  title={
                    props.preferences.sortOrder === "asc"
                      ? props.labels.ascending
                      : props.labels.descending
                  }
                >
                  {props.preferences.sortOrder === "asc" ? (
                    <FaSolidArrowUp />
                  ) : (
                    <FaSolidArrowDown />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
};

export { DisplayOptionsModal };
export default DisplayOptionsModal;
