import { Show, createSignal, createEffect, createMemo } from "solid-js";
import type { ResolvedGrant, RuntimeAppManifest, UserProfile } from "@edenapp/types";
import { FaSolidCode, FaSolidList } from "solid-icons/fa";
import { getLocalizedValue, locale, t } from "../../i18n";
import {
  canLaunchApp,
  getGrantScope,
  getGrantId,
  getResolvedGrants,
} from "../../grants";
import type { SettingsOption } from "./types";
import UserDetailHeader from "./UserDetailHeader";
import GrantsEasyMode from "./GrantsEasyMode";
import GrantsRawMode from "./GrantsRawMode";

interface UserDetailProps {
  user: UserProfile;
  currentUser: UserProfile | null;
  installedApps: RuntimeAppManifest[];
  settingsOptions: SettingsOption[];
  isDefaultUser: boolean;
  onBack: () => void;
  onDelete: (username: string) => void;
  onOpenPasswordModal: (user: UserProfile) => void;
  onToggleDefaultUser: (username: string, enabled: boolean) => void;
  updateGrants: (
    username: string,
    updater: (grants: Set<string>) => Set<string>
  ) => void;
}

const UserDetail = (props: UserDetailProps) => {
  const [mode, setMode] = createSignal<"easy" | "raw">("easy");
  const [rawGrantText, setRawGrantText] = createSignal("");

  // Sync raw text when user changes
  createEffect(() => {
    setRawGrantText((props.user.grants || []).join("\n"));
  });

  const handleSaveRaw = () => {
    props.updateGrants(props.user.username, () => {
      const set = new Set<string>();
      rawGrantText()
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((s) => set.add(s));
      return set;
    });
  };

  const updateGrants = (updater: (grants: Set<string>) => Set<string>): void => {
    props.updateGrants(props.user.username, (grants) => {
      if (grants.has("*")) {
        grants.delete("*");
      }
      return updater(grants);
    });
  };

  const isCurrent = () => props.currentUser?.username === props.user.username;
  const isVendor = () => props.user.role === "vendor";
  const hasWildcard = () => props.user.grants?.includes("*") ?? false;
  const allowAllApps = () =>
    hasWildcard() || (props.user.grants?.includes("apps/launch/*") ?? false);
  const allowAllSettings = () =>
    hasWildcard() || (props.user.grants?.includes("settings/*") ?? false);

  const grantableApps = createMemo(() =>
    props.installedApps.filter((app) => !app.isCore && !app.isRestricted)
  );

  const launchableApps = createMemo(() => {
    const apps = props.installedApps.filter((app) =>
      canLaunchApp(app, props.user.grants ?? [], isVendor())
    );
    return apps.sort((a, b) =>
      getLocalizedValue(a.name, locale()).localeCompare(
        getLocalizedValue(b.name, locale())
      )
    );
  });

  const appGrantApps = createMemo(() =>
    launchableApps().filter((app) =>
      getResolvedGrants(app).some((grant) => getGrantScope(grant) === "app")
    )
  );

  const systemGrants = createMemo(() => {
    const map = new Map<string, ResolvedGrant>();
    for (const app of launchableApps()) {
      for (const grant of getResolvedGrants(app)) {
        if (getGrantScope(grant) !== "preset") continue;
        const id = getGrantId(grant);
        if (!id) continue;
        if (!map.has(id)) {
          map.set(id, grant);
        }
      }
    }
    const grants = Array.from(map.values());
    return grants.sort((a, b) => {
      const labelA =
        typeof a.label === "string" ? a.label : getLocalizedValue(a.label ?? a.preset, locale());
      const labelB =
        typeof b.label === "string" ? b.label : getLocalizedValue(b.label ?? b.preset, locale());
      return labelA.localeCompare(labelB);
    });
  });

  return (
    <div class="eden-card eden-card-glass eden-flex-col eden-gap-md">
      <UserDetailHeader
        user={props.user}
        isCurrent={isCurrent()}
        isVendor={isVendor()}
        onBack={props.onBack}
        onDelete={() => props.onDelete(props.user.username)}
        onSetPassword={() => props.onOpenPasswordModal(props.user)}
      />

      <div class="eden-card-body eden-flex-col eden-gap-lg">
        <label class="eden-list-item eden-list-item-interactive eden-flex-between">
          <div class="eden-list-item-content">
            <span class="eden-list-item-title">{t("settings.users.autoLogin")}</span>
            <span class="eden-list-item-description">
              {t("settings.users.autoLoginDescription")}
            </span>
          </div>
          <input
            type="checkbox"
            class="eden-toggle"
            checked={props.isDefaultUser}
            onChange={(e) =>
              props.onToggleDefaultUser(props.user.username, e.currentTarget.checked)
            }
          />
        </label>

        <div class="eden-tabs">
          <div class="eden-tab-list">
            <button
              class={`eden-tab eden-flex-center eden-gap-md ${
                mode() === "easy" ? "eden-tab-active" : ""
              }`}
              style={{ flex: 1 }}
              onClick={() => setMode("easy")}
            >
              <FaSolidList />
              <span>{t("settings.users.modeEasy")}</span>
            </button>
            <button
              class={`eden-tab eden-flex-center eden-gap-md ${
                mode() === "raw" ? "eden-tab-active" : ""
              }`}
              style={{ flex: 1 }}
              onClick={() => setMode("raw")}
            >
              <FaSolidCode />
              <span>{t("settings.users.modeRaw")}</span>
            </button>
          </div>
        </div>

        <Show when={mode() === "easy"}>
          <GrantsEasyMode
            grants={props.user.grants ?? []}
            isVendor={isVendor()}
            allowAllApps={allowAllApps()}
            allowAllSettings={allowAllSettings()}
            grantableApps={grantableApps()}
            settingsOptions={props.settingsOptions}
            systemGrants={systemGrants}
            appGrantApps={appGrantApps}
            updateGrants={updateGrants}
          />
        </Show>

        <Show when={mode() === "raw"}>
          <GrantsRawMode
            rawGrantText={rawGrantText}
            onTextChange={setRawGrantText}
            onSave={handleSaveRaw}
          />
        </Show>
      </div>
    </div>
  );
};

export default UserDetail;
