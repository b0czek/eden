import { Show, For } from "solid-js";
import type { Component } from "solid-js";
import type { AppManifest } from "@edenapp/types";
import { FiTrash2, FiPackage, FiCpu, FiArrowLeft } from "solid-icons/fi";
import { t, locale, getLocalizedValue } from "../../i18n";

interface AppDetailProps {
  app: AppManifest;
  appIcon?: string;
  autostart: boolean;
  sizeLoading: boolean;
  size?: number;
  uninstalling: boolean;
  onBack: () => void;
  onAutostartToggle: (enabled: boolean) => void;
  onUninstall: (e: MouseEvent) => void;
}

const formatBytes = (bytes?: number): string => {
  if (bytes === undefined) {
    return t("settings.apps.sizeUnavailable");
  }
  if (bytes === 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value < 10 && unitIndex > 0 ? 1 : 0)} ${
    units[unitIndex]
  }`;
};

const AppDetail: Component<AppDetailProps> = (props) => {
  return (
    <div class="eden-card eden-card-glass eden-flex-col eden-gap-md">
      <div class="eden-card-header eden-flex eden-flex-between eden-items-center">
        <div class="eden-flex eden-items-center eden-gap-md">
          <button
            type="button"
            class="eden-btn eden-btn-ghost eden-btn-icon"
            onClick={props.onBack}
            title={t("common.back")}
          >
            <FiArrowLeft />
          </button>
          <div class="eden-flex eden-items-center eden-gap-md">
            <div
              class={
                props.appIcon
                  ? "app-detail-icon app-detail-icon-no-bg"
                  : "app-detail-icon"
              }
            >
              <Show
                when={props.appIcon}
                fallback={
                  props.app.isPrebuilt ? (
                    <div class="eden-flex-center eden-h-full eden-w-full eden-text-tertiary">
                      <FiCpu />
                    </div>
                  ) : (
                    <div class="eden-flex-center eden-h-full eden-w-full eden-text-tertiary">
                      <FiPackage />
                    </div>
                  )
                }
              >
                <img
                  src={props.appIcon}
                  alt={getLocalizedValue(props.app.name, locale())}
                />
              </Show>
            </div>
            <div class="eden-flex eden-flex-col">
              <h3 class="eden-card-title">
                {getLocalizedValue(props.app.name, locale())}
              </h3>
              <div class="eden-flex eden-gap-xs eden-items-center">
                <span class="eden-text-xs eden-text-tertiary">
                  {props.app.id}
                </span>
                <Show when={props.app.isPrebuilt}>
                  <span class="eden-badge eden-badge-info eden-badge-sm">
                    {t("settings.apps.builtin")}
                  </span>
                </Show>
              </div>
            </div>
          </div>
        </div>

        <div class="eden-flex eden-gap-sm eden-items-center">
           <label class="eden-flex eden-items-center eden-gap-sm eden-text-sm eden-text-secondary eden-interactive">
            <span>{t("settings.apps.autostart")}</span>
            <input
              type="checkbox"
              class="eden-toggle"
              checked={props.autostart}
              onChange={(event) =>
                props.onAutostartToggle(
                  (event.target as HTMLInputElement).checked
                )
              }
            />
          </label>
          <Show when={!props.app.isPrebuilt}>
            <button
              class="eden-btn eden-btn-danger eden-btn-sm eden-btn-icon"
              disabled={props.uninstalling}
              onClick={(e) => props.onUninstall(e)}
              title={t("settings.apps.uninstallApp")}
            >
              <Show when={props.uninstalling} fallback={<FiTrash2 />}>
                ...
              </Show>
            </button>
          </Show>
        </div>
      </div>

      <div class="eden-card-body eden-flex-col eden-gap-lg">
        <div class="eden-text-sm eden-text-secondary">
            {props.app.description ||
              (props.app.isPrebuilt
                ? t("settings.apps.systemComponent")
                : t("settings.apps.noDescription"))}
        </div>

        <div class="eden-grid eden-grid-2 eden-gap-md">
          <div class="eden-flex eden-flex-col eden-gap-xs">
             <span class="eden-text-xs eden-text-tertiary eden-uppercase eden-tracking-wide eden-font-bold">{t("common.version")}</span>
             <span class="eden-text-md">{props.app.version}</span>
          </div>
          <div class="eden-flex eden-flex-col eden-gap-xs">
             <span class="eden-text-xs eden-text-tertiary eden-uppercase eden-tracking-wide eden-font-bold">{t("common.size")}</span>
             <span class="eden-text-md">
               <Show when={!props.sizeLoading} fallback={t("common.loading")}>
                 {formatBytes(props.size)}
               </Show>
             </span>
          </div>
          <div class="eden-flex eden-flex-col eden-gap-xs">
             <span class="eden-text-xs eden-text-tertiary eden-uppercase eden-tracking-wide eden-font-bold">{t("settings.apps.details.source")}</span>
             <span class="eden-text-md">
              {props.app.isPrebuilt
                ? t("settings.apps.builtin")
                : t("settings.apps.userInstalled")}
             </span>
          </div>
          <div class="eden-flex eden-flex-col eden-gap-xs">
             <span class="eden-text-xs eden-text-tertiary eden-uppercase eden-tracking-wide eden-font-bold">{t("settings.apps.details.windowMode")}</span>
             <span class="eden-text-md">
              {props.app.window?.mode ??
                t("settings.apps.details.windowModeUnknown")}
             </span>
          </div>
        </div>

        <div class="eden-flex eden-flex-col eden-gap-sm">
          <h4 class="eden-text-sm eden-font-semibold">
            {t("settings.apps.details.capabilities")}
          </h4>
          <div class="eden-flex eden-gap-xs eden-flex-wrap">
            <Show
              when={
                props.app.frontend ||
                props.app.backend ||
                props.app.overlay ||
                props.app.hidden
              }
              fallback={
                <span class="eden-text-xs eden-text-tertiary">
                  {t("settings.apps.details.noCapabilities")}
                </span>
              }
            >
              <Show when={props.app.frontend}>
                <span class="eden-badge">
                  {t("settings.apps.details.frontend")}
                </span>
              </Show>
              <Show when={props.app.backend}>
                <span class="eden-badge">
                  {t("settings.apps.details.backend")}
                </span>
              </Show>
              <Show when={props.app.overlay}>
                <span class="eden-badge">
                  {t("settings.apps.details.overlay")}
                </span>
              </Show>
              <Show when={props.app.hidden}>
                <span class="eden-badge">
                  {t("settings.apps.details.hidden")}
                </span>
              </Show>
            </Show>
          </div>
        </div>

        <div class="eden-flex eden-flex-col eden-gap-sm">
          <h4 class="eden-text-sm eden-font-semibold">
            {t("settings.apps.details.permissions")}
          </h4>
          <div class="eden-flex eden-gap-xs eden-flex-wrap">
            <Show
              when={(props.app.permissions?.length ?? 0) > 0}
              fallback={
                <span class="eden-text-xs eden-text-tertiary">
                  {t("settings.apps.details.noPermissions")}
                </span>
              }
            >
              <For each={props.app.permissions ?? []}>
                {(permission) => (
                  <span class="eden-badge eden-badge-mono">{permission}</span>
                )}
              </For>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AppDetail;
