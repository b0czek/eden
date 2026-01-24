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
    <section class="apps-detail-panel eden-flex-col eden-gap-md">
      <button
        type="button"
        class="eden-btn eden-btn-ghost eden-btn-sm apps-back"
        onClick={props.onBack}
      >
        <FiArrowLeft />
        {t("common.back")}
      </button>
      <div class="app-detail eden-flex-col eden-gap-lg">
        <header class="app-detail-header content-header">
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
                    <FiCpu class="app-detail-fallback-icon" />
                  ) : (
                    <FiPackage class="app-detail-fallback-icon" />
                  )
                }
              >
                <img
                  src={props.appIcon}
                  alt={getLocalizedValue(props.app.name, locale())}
                />
              </Show>
            </div>
            <div class="app-detail-heading">
              <h3 class="content-title">
                {getLocalizedValue(props.app.name, locale())}
              </h3>
              <p class="content-description">
                {props.app.description ||
                  (props.app.isPrebuilt
                    ? t("settings.apps.systemComponent")
                    : t("settings.apps.noDescription"))}
              </p>
              <div class="app-detail-id eden-text-xs eden-text-tertiary">
                {props.app.id}
              </div>
            </div>
          </div>
        </header>

        <div class="app-detail-actions eden-flex eden-items-center eden-gap-sm">
          <div class="eden-flex eden-items-center eden-gap-sm">
            <span class="eden-text-sm eden-text-tertiary">
              {t("settings.apps.autostart")}
            </span>
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
          </div>
          <Show when={!props.app.isPrebuilt}>
            <button
              class="eden-btn eden-btn-danger eden-btn-sm"
              disabled={props.uninstalling}
              onClick={(e) => props.onUninstall(e)}
              title={t("settings.apps.uninstallApp")}
            >
              <Show when={props.uninstalling} fallback={<FiTrash2 />}>
                ...
              </Show>
            </button>
          </Show>
          <Show when={props.app.isPrebuilt}>
            <span class="eden-badge eden-badge-info">
              {t("settings.apps.builtin")}
            </span>
          </Show>
        </div>

        <div class="app-detail-grid">
          <div class="app-detail-item">
            <div class="app-detail-label">
              {t("settings.apps.details.version")}
            </div>
            <div class="app-detail-value">v{props.app.version}</div>
          </div>
          <div class="app-detail-item">
            <div class="app-detail-label">
              {t("settings.apps.details.size")}
            </div>
            <div class="app-detail-value">
              <Show when={!props.sizeLoading} fallback={t("common.loading")}>
                {formatBytes(props.size)}
              </Show>
            </div>
          </div>
          <div class="app-detail-item">
            <div class="app-detail-label">
              {t("settings.apps.details.source")}
            </div>
            <div class="app-detail-value">
              {props.app.isPrebuilt
                ? t("settings.apps.builtin")
                : t("settings.apps.userInstalled")}
            </div>
          </div>
          <div class="app-detail-item">
            <div class="app-detail-label">
              {t("settings.apps.details.windowMode")}
            </div>
            <div class="app-detail-value">
              {props.app.window?.mode ??
                t("settings.apps.details.windowModeUnknown")}
            </div>
          </div>
        </div>

        <div class="app-detail-section eden-flex-col eden-gap-sm">
          <h4 class="app-detail-section-title eden-text-sm eden-font-semibold">
            {t("settings.apps.details.capabilities")}
          </h4>
          <div class="app-detail-tags eden-flex eden-gap-xs">
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
                <span class="eden-tag">
                  {t("settings.apps.details.frontend")}
                </span>
              </Show>
              <Show when={props.app.backend}>
                <span class="eden-tag">
                  {t("settings.apps.details.backend")}
                </span>
              </Show>
              <Show when={props.app.overlay}>
                <span class="eden-tag">
                  {t("settings.apps.details.overlay")}
                </span>
              </Show>
              <Show when={props.app.hidden}>
                <span class="eden-tag">
                  {t("settings.apps.details.hidden")}
                </span>
              </Show>
            </Show>
          </div>
        </div>

        <div class="app-detail-section eden-flex-col eden-gap-sm">
          <h4 class="app-detail-section-title eden-text-sm eden-font-semibold">
            {t("settings.apps.details.permissions")}
          </h4>
          <div class="app-detail-tags eden-flex eden-gap-xs">
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
                  <span class="eden-tag eden-tag-mono">{permission}</span>
                )}
              </For>
            </Show>
          </div>
        </div>
      </div>
    </section>
  );
};

export default AppDetail;
