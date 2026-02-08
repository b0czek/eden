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
              onChange={(e) =>
                props.updateGrants((grants) => {
                  if (e.currentTarget.checked) {
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
              onChange={(e) =>
                props.updateGrants((grants) => {
                  if (e.currentTarget.checked) {
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
                  <label class="eden-list-item eden-list-item-interactive eden-flex-between">
                    <span class="eden-list-item-title">
                      {getLocalizedValue(app.name, locale())}
                    </span>
                    <input
                      type="checkbox"
                      class="eden-toggle"
                      checked={appGrants().has(buildAppGrant(app.id))}
                      onChange={(e) =>
                        props.updateGrants((grants) => {
                          const perm = buildAppGrant(app.id);
                          grants.delete("apps/launch/*");
                          if (e.currentTarget.checked) {
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
                        <input
                          type="checkbox"
                          class="eden-toggle"
                          checked={
                            grantId
                              ? hasPresetGrant(props.grants, grantId)
                              : false
                          }
                          onChange={(e) =>
                            props.updateGrants((grants) => {
                              if (!grantId) {
                                return grants;
                              }
                              const perm = buildPresetGrant(grantId);
                              if (e.currentTarget.checked) {
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
                            <input
                              type="checkbox"
                              class="eden-toggle"
                              checked={hasAppFeatureGrant(
                                props.grants,
                                app.id,
                                getGrantId(grant),
                                getGrantScope(grant),
                              )}
                              onChange={(e) =>
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
                                  if (e.currentTarget.checked) {
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
                  <label class="eden-list-item eden-list-item-interactive eden-flex-between">
                    <span class="eden-list-item-title">{option.label}</span>
                    <input
                      type="checkbox"
                      class="eden-toggle"
                      checked={settingGrants().has(
                        buildSettingGrant(option.appId, option.id),
                      )}
                      onChange={(e) =>
                        props.updateGrants((grants) => {
                          const perm = buildSettingGrant(
                            option.appId,
                            option.id,
                          );
                          grants.delete("settings/*");
                          if (e.currentTarget.checked) {
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
