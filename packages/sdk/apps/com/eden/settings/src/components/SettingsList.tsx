import { For, Show, type Accessor, type Component } from "solid-js";
import type { Store } from "solid-js/store";
import type { SettingsCategory } from "@edenapp/types";
import SettingInput from "./SettingInput";
import { getLocalizedValue, locale } from "../i18n";

interface SettingsListProps {
  categories: Accessor<SettingsCategory[]>;
  values: Store<Record<string, string>>;
  onSettingChange: (key: string, value: string) => void;
}

const SettingsList: Component<SettingsListProps> = (props) => (
  <div class="settings-list">
    <For each={props.categories()}>
      {(category) => (
        <>
          <Show when={props.categories().length > 1}>
            <h3 class="category-header">
              {getLocalizedValue(category.name, locale())}
            </h3>
          </Show>
          <For each={category.settings}>
            {(setting) => (
                <SettingInput
                  setting={setting}
                  value={
                    (props.values[setting.key] as string) ??
                    setting.defaultValue ??
                    ""
                  }
                  onChange={(value) =>
                    props.onSettingChange(setting.key, value)
                  }
                />
            )}
          </For>
        </>
      )}
    </For>
  </div>
);

export default SettingsList;
