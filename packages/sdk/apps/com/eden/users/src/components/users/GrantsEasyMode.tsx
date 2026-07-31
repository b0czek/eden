import type { UserGrantOption } from "@edenapp/types";
import { createMemo, For, Show } from "solid-js";
import { matchesGrant } from "../../grants";
import { getLocalizedValue, locale, t } from "../../i18n";

interface GrantsEasyModeProps {
  grants: string[];
  isVendor: boolean;
  allowAllApps: boolean;
  allowAllSettings: boolean;
  options: UserGrantOption[];
  updateGrants: (updater: (grants: Set<string>) => Set<string>) => void;
}

const GrantsEasyMode = (props: GrantsEasyModeProps) => {
  const optionsByKind = (kind: UserGrantOption["kind"]) =>
    props.options.filter((option) => option.kind === kind);
  const appOptions = () => optionsByKind("app-launch");
  const presetOptions = () => optionsByKind("preset");
  const settingsOptions = () =>
    props.options.filter(
      (option) =>
        (option.kind === "setting" ||
          option.kind === "panel" ||
          option.kind === "panel-action") &&
        (!props.allowAllSettings || !option.grant.startsWith("settings/")),
    );
  const appFeatureGroups = createMemo(() => {
    const groups = new Map<
      string,
      { label: UserGrantOption["label"]; options: UserGrantOption[] }
    >();
    for (const option of optionsByKind("app-feature")) {
      const ownerId = option.ownerId ?? "app";
      const group = groups.get(ownerId) ?? {
        label: option.ownerLabel ?? ownerId,
        options: [],
      };
      group.options.push(option);
      groups.set(ownerId, group);
    }
    return Array.from(groups.entries());
  });

  const setOption = (option: UserGrantOption, enabled: boolean) => {
    props.updateGrants((grants) => {
      if (option.kind === "app-launch") grants.delete("apps/launch/*");
      if (option.kind === "app-feature") {
        grants.delete("app/*");
        if (option.ownerId) grants.delete(`app/${option.ownerId}/*`);
      }
      if (option.kind === "preset") grants.delete("preset/*");
      if (option.grant.startsWith("settings/")) grants.delete("settings/*");
      if (enabled) grants.add(option.grant);
      else grants.delete(option.grant);
      return grants;
    });
  };
  const optionLabel = (option: UserGrantOption) => {
    const label = getLocalizedValue(option.label, locale());
    const owner = option.ownerLabel
      ? getLocalizedValue(option.ownerLabel, locale())
      : "";
    return owner && owner !== label ? `${owner} · ${label}` : label;
  };

  const OptionRow = (rowProps: { option: UserGrantOption }) => (
    <label class="eden-list-item eden-list-item-interactive eden-flex-between">
      <div class="eden-list-item-content">
        <span class="eden-list-item-title">{optionLabel(rowProps.option)}</span>
        <Show when={rowProps.option.description}>
          {(description) => (
            <span class="eden-list-item-description">
              {getLocalizedValue(description(), locale())}
            </span>
          )}
        </Show>
      </div>
      <input
        type="checkbox"
        class="eden-toggle"
        checked={matchesGrant(props.grants, rowProps.option.grant)}
        onChange={(event) =>
          setOption(rowProps.option, event.currentTarget.checked)
        }
      />
    </label>
  );

  return (
    <div class="eden-flex eden-flex-col eden-gap-lg">
      <div class="eden-text-lg eden-font-semibold">
        {t("settings.users.grants")}
      </div>

      <Show
        when={!props.isVendor}
        fallback={
          <div class="eden-text-secondary">
            {t("settings.users.vendorNotice")}
          </div>
        }
      >
        <div class="eden-list">
          <label class="eden-list-item eden-list-item-interactive eden-flex-between">
            <div class="eden-list-item-content">
              <span class="eden-list-item-title">
                {t("settings.users.allowAllApps")}
              </span>
              <span class="eden-list-item-description">
                {t("settings.users.allowAllAppsDescription")}
              </span>
            </div>
            <input
              type="checkbox"
              class="eden-toggle"
              checked={props.allowAllApps}
              onChange={(event) =>
                props.updateGrants((grants) => {
                  if (event.currentTarget.checked) {
                    grants.add("apps/launch/*");
                    for (const grant of grants) {
                      if (
                        grant.startsWith("apps/launch/") &&
                        grant !== "apps/launch/*"
                      ) {
                        grants.delete(grant);
                      }
                    }
                  } else grants.delete("apps/launch/*");
                  return grants;
                })
              }
            />
          </label>

          <label class="eden-list-item eden-list-item-interactive eden-flex-between">
            <div class="eden-list-item-content">
              <span class="eden-list-item-title">
                {t("settings.users.allowAllSettings")}
              </span>
              <span class="eden-list-item-description">
                {t("settings.users.allowAllSettingsDescription")}
              </span>
            </div>
            <input
              type="checkbox"
              class="eden-toggle"
              checked={props.allowAllSettings}
              onChange={(event) =>
                props.updateGrants((grants) => {
                  if (event.currentTarget.checked) {
                    grants.add("settings/*");
                    for (const grant of grants) {
                      if (
                        grant.startsWith("settings/") &&
                        grant !== "settings/*"
                      ) {
                        grants.delete(grant);
                      }
                    }
                  } else grants.delete("settings/*");
                  return grants;
                })
              }
            />
          </label>
        </div>

        <Show when={!props.allowAllApps && appOptions().length > 0}>
          <div class="eden-flex eden-flex-col eden-gap-sm">
            <div class="eden-text-sm eden-text-secondary eden-uppercase eden-tracking-wide eden-font-bold">
              {t("settings.users.appAccess")}
            </div>
            <div class="eden-list eden-scrollbar">
              <For each={appOptions()}>
                {(option) => <OptionRow option={option} />}
              </For>
            </div>
          </div>
        </Show>

        <Show when={presetOptions().length > 0}>
          <div class="eden-flex eden-flex-col eden-gap-sm">
            <div class="eden-text-md eden-text-secondary eden-uppercase eden-tracking-wide eden-font-bold">
              {t("settings.users.systemGrants")}
            </div>
            <div class="eden-list eden-scrollbar">
              <For each={presetOptions()}>
                {(option) => <OptionRow option={option} />}
              </For>
            </div>
          </div>
        </Show>

        <Show when={appFeatureGroups().length > 0}>
          <div class="eden-flex eden-flex-col eden-gap-sm">
            <div class="eden-text-md eden-text-secondary eden-uppercase eden-tracking-wide eden-font-bold">
              {t("settings.users.appGrants")}
            </div>
            <div class="eden-flex eden-flex-col eden-gap-md">
              <For each={appFeatureGroups()}>
                {([, group]) => (
                  <div class="eden-flex eden-flex-col eden-gap-sm">
                    <div class="eden-text-sm eden-font-semibold">
                      {getLocalizedValue(group.label, locale())}
                    </div>
                    <div class="eden-list eden-scrollbar">
                      <For each={group.options}>
                        {(option) => <OptionRow option={option} />}
                      </For>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

        <Show when={settingsOptions().length > 0}>
          <div class="eden-flex eden-flex-col eden-gap-sm">
            <div class="eden-text-sm eden-text-secondary eden-uppercase eden-tracking-wide eden-font-bold">
              {t("settings.users.settingsAccess")}
            </div>
            <div class="eden-list eden-scrollbar">
              <For each={settingsOptions()}>
                {(option) => <OptionRow option={option} />}
              </For>
            </div>
          </div>
        </Show>
      </Show>
    </div>
  );
};

export default GrantsEasyMode;
