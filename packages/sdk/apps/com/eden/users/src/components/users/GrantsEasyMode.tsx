import { Switch } from "@edenapp/solid-kit";
import type { ResolvedGrant, RuntimeAppManifest } from "@edenapp/types";
import type { Accessor } from "solid-js";
import { For, Show } from "solid-js";
import {
  buildAppGrant,
  buildPresetGrant,
  buildSettingGrant,
  getAppGrantKey,
  getAppScopedGrants,
  getGrantId,
  getGrantLabel,
  getGrantScope,
  hasAppFeatureGrant,
  hasPresetGrant,
} from "../../grants";
import { getLocalizedValue, locale, t } from "../../i18n";
import type { SettingsOption } from "./types";

interface GrantsEasyModeProps {
  grants: string[];
  isVendor: boolean;
  allowAllApps: boolean;
  allowAllSettings: boolean;
  grantableApps: RuntimeAppManifest[];
  settingsOptions: SettingsOption[];
  systemGrants: Accessor<ResolvedGrant[]>;
  appGrantApps: Accessor<RuntimeAppManifest[]>;
  updateGrants: (updater: (grants: Set<string>) => Set<string>) => void;
}

const GrantSwitch = (props: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel: string;
}) => (
  <Switch checked={props.checked} onChange={props.onChange}>
    <Switch.Input aria-label={props.ariaLabel} />
    <Switch.Control>
      <Switch.Thumb />
    </Switch.Control>
  </Switch>
);

const GrantsEasyMode = (props: GrantsEasyModeProps) => {
  const appGrants = () =>
    new Set(
      props.grants.filter(
        (grant) =>
          grant.startsWith("apps/launch/") && grant !== "apps/launch/*",
      ),
    );

  const settingGrants = () =>
    new Set(
      props.grants.filter(
        (grant) => grant.startsWith("settings/") && grant !== "settings/*",
      ),
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
        {/* Allow All Toggles */}
        <div class="eden-list">
          {/* biome-ignore lint/a11y/noLabelWithoutControl: The nested Kobalte Switch.Input is the row control. */}
          <label class="eden-list-item eden-list-item-interactive eden-flex-between">
            <div class="eden-list-item-content">
              <span class="eden-list-item-title">
                {t("settings.users.allowAllApps")}
              </span>
              <span class="eden-list-item-description">
                {t("settings.users.allowAllAppsDescription")}
              </span>
            </div>
            <GrantSwitch
              checked={props.allowAllApps}
              ariaLabel={t("settings.users.allowAllApps")}
              onChange={(checked) =>
                props.updateGrants((grants) => {
                  if (checked) {
                    grants.add("apps/launch/*");
                    for (const perm of grants) {
                      if (
                        perm.startsWith("apps/launch/") &&
                        perm !== "apps/launch/*"
                      ) {
                        grants.delete(perm);
                      }
                    }
                  } else {
                    grants.delete("apps/launch/*");
                  }
                  return grants;
                })
              }
            />
          </label>

          {/* biome-ignore lint/a11y/noLabelWithoutControl: The nested Kobalte Switch.Input is the row control. */}
          <label class="eden-list-item eden-list-item-interactive eden-flex-between">
            <div class="eden-list-item-content">
              <span class="eden-list-item-title">
                {t("settings.users.allowAllSettings")}
              </span>
              <span class="eden-list-item-description">
                {t("settings.users.allowAllSettingsDescription")}
              </span>
            </div>
            <GrantSwitch
              checked={props.allowAllSettings}
              ariaLabel={t("settings.users.allowAllSettings")}
              onChange={(checked) =>
                props.updateGrants((grants) => {
                  if (checked) {
                    grants.add("settings/*");
                    for (const perm of grants) {
                      if (
                        perm.startsWith("settings/") &&
                        perm !== "settings/*"
                      ) {
                        grants.delete(perm);
                      }
                    }
                  } else {
                    grants.delete("settings/*");
                  }
                  return grants;
                })
              }
            />
          </label>
        </div>

        {/* App Access */}
        <Show when={!props.allowAllApps}>
          <div class="eden-flex eden-flex-col eden-gap-sm">
            <div class="eden-text-sm eden-text-secondary eden-uppercase eden-tracking-wide eden-font-bold">
              {t("settings.users.appAccess")}
            </div>
            <div class="eden-list eden-scrollbar">
              <For each={props.grantableApps}>
                {(app) => (
                  /* biome-ignore lint/a11y/noLabelWithoutControl: The nested Kobalte Switch.Input is the row control. */
                  <label class="eden-list-item eden-list-item-interactive eden-flex-between">
                    <span class="eden-list-item-title">
                      {getLocalizedValue(app.name, locale())}
                    </span>
                    <GrantSwitch
                      checked={appGrants().has(buildAppGrant(app.id))}
                      ariaLabel={getLocalizedValue(app.name, locale())}
                      onChange={(checked) =>
                        props.updateGrants((grants) => {
                          const perm = buildAppGrant(app.id);
                          grants.delete("apps/launch/*");
                          if (checked) {
                            grants.add(perm);
                          } else {
                            grants.delete(perm);
                          }
                          return grants;
                        })
                      }
                    />
                  </label>
                )}
              </For>
            </div>
          </div>
        </Show>

        {/* System Grants */}
        <Show when={props.systemGrants().length > 0}>
          <div class="eden-flex eden-flex-col eden-gap-sm">
            <div class="eden-text-md eden-text-secondary eden-uppercase eden-tracking-wide eden-font-bold">
              {t("settings.users.systemGrants")}
            </div>
            <div class="eden-flex eden-flex-col eden-gap-md">
              <div class="eden-list eden-scrollbar">
                <For each={props.systemGrants()}>
                  {(grant) => {
                    const grantId = getGrantId(grant);
                    return (
                      /* biome-ignore lint/a11y/noLabelWithoutControl: The nested Kobalte Switch.Input is the row control. */
                      <label class="eden-list-item eden-list-item-interactive eden-flex-between">
                        <div class="eden-list-item-content">
                          <span class="eden-list-item-title">
                            {getLocalizedValue(getGrantLabel(grant), locale())}
                          </span>
                          <Show when={grant.description}>
                            <span class="eden-list-item-description">
                              {getLocalizedValue(grant.description, locale())}
                            </span>
                          </Show>
                        </div>
                        <GrantSwitch
                          checked={
                            grantId
                              ? hasPresetGrant(props.grants, grantId)
                              : false
                          }
                          ariaLabel={getLocalizedValue(
                            getGrantLabel(grant),
                            locale(),
                          )}
                          onChange={(checked) =>
                            props.updateGrants((grants) => {
                              if (!grantId) {
                                return grants;
                              }
                              const perm = buildPresetGrant(grantId);
                              if (checked) {
                                grants.add(perm);
                              } else {
                                grants.delete(perm);
                              }
                              return grants;
                            })
                          }
                        />
                      </label>
                    );
                  }}
                </For>
              </div>
            </div>
          </div>
        </Show>

        {/* App Grants */}
        <Show when={props.appGrantApps().length > 0}>
          <div class="eden-flex eden-flex-col eden-gap-sm">
            <div class="eden-text-md eden-text-secondary eden-uppercase eden-tracking-wide eden-font-bold">
              {t("settings.users.appGrants")}
            </div>
            <div class="eden-flex eden-flex-col eden-gap-md">
              <For each={props.appGrantApps()}>
                {(app) => (
                  <div class="eden-flex eden-flex-col eden-gap-sm">
                    <div class="eden-text-sm eden-font-semibold">
                      {getLocalizedValue(app.name, locale())}
                    </div>
                    <div class="eden-list eden-scrollbar">
                      <For each={getAppScopedGrants(app)}>
                        {(grant) => (
                          /* biome-ignore lint/a11y/noLabelWithoutControl: The nested Kobalte Switch.Input is the row control. */
                          <label class="eden-list-item eden-list-item-interactive eden-flex-between">
                            <div class="eden-list-item-content">
                              <span class="eden-list-item-title">
                                {getLocalizedValue(
                                  getGrantLabel(grant),
                                  locale(),
                                )}
                              </span>
                              <Show when={grant.description}>
                                <span class="eden-list-item-description">
                                  {getLocalizedValue(
                                    grant.description,
                                    locale(),
                                  )}
                                </span>
                              </Show>
                            </div>
                            <GrantSwitch
                              checked={hasAppFeatureGrant(
                                props.grants,
                                app.id,
                                getGrantId(grant),
                                getGrantScope(grant),
                              )}
                              ariaLabel={getLocalizedValue(
                                getGrantLabel(grant),
                                locale(),
                              )}
                              onChange={(checked) =>
                                props.updateGrants((grants) => {
                                  const scope = getGrantScope(grant);
                                  const perm = getAppGrantKey(
                                    app.id,
                                    getGrantId(grant),
                                    scope,
                                  );
                                  if (!perm) {
                                    return grants;
                                  }
                                  if (scope === "app") {
                                    grants.delete("app/*");
                                    grants.delete(`app/${app.id}/*`);
                                  }
                                  if (checked) {
                                    grants.add(perm);
                                  } else {
                                    grants.delete(perm);
                                  }
                                  return grants;
                                })
                              }
                            />
                          </label>
                        )}
                      </For>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

        {/* Settings Access */}
        <Show when={!props.allowAllSettings}>
          <div class="eden-flex eden-flex-col eden-gap-sm">
            <div class="eden-text-sm eden-text-secondary eden-uppercase eden-tracking-wide eden-font-bold">
              {t("settings.users.settingsAccess")}
            </div>
            <div class="eden-list eden-scrollbar">
              <For each={props.settingsOptions}>
                {(option) => (
                  /* biome-ignore lint/a11y/noLabelWithoutControl: The nested Kobalte Switch.Input is the row control. */
                  <label class="eden-list-item eden-list-item-interactive eden-flex-between">
                    <span class="eden-list-item-title">{option.label}</span>
                    <GrantSwitch
                      checked={settingGrants().has(
                        buildSettingGrant(option.appId, option.id),
                      )}
                      ariaLabel={option.label}
                      onChange={(checked) =>
                        props.updateGrants((grants) => {
                          const perm = buildSettingGrant(
                            option.appId,
                            option.id,
                          );
                          grants.delete("settings/*");
                          if (checked) {
                            grants.add(perm);
                          } else {
                            grants.delete(perm);
                          }
                          return grants;
                        })
                      }
                    />
                  </label>
                )}
              </For>
            </div>
          </div>
        </Show>
      </Show>
    </div>
  );
};

export default GrantsEasyMode;
