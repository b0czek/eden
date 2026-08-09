import type { RuntimeDlcManifest } from "@edenapp/types";
import { FiArrowLeft, FiPackage, FiTrash2 } from "solid-icons/fi";
import type { Component } from "solid-js";
import { For, Show } from "solid-js";
import { getLocalizedValue, locale, t } from "../../i18n";

const formatBytes = (bytes?: number): string => {
  if (bytes === undefined) return t("settings.apps.sizeUnavailable");
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
};

const DlcDetail: Component<{
  dlc: RuntimeDlcManifest;
  icon?: string;
  hostName: string;
  size?: number;
  sizeLoading: boolean;
  uninstalling: boolean;
  onBack: () => void;
  onUninstall: () => void;
}> = (props) => (
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
        <div class="app-detail-icon">
          <Show when={props.icon} fallback={<FiPackage />}>
            <img src={props.icon} alt="" />
          </Show>
        </div>
        <div class="eden-flex eden-flex-col eden-gap-xs">
          <h3 class="eden-card-title">
            {getLocalizedValue(props.dlc.name, locale())}
          </h3>
          <div class="eden-flex eden-items-center eden-gap-xs">
            <span class="eden-text-xs eden-text-tertiary">{props.dlc.id}</span>
            <span class="eden-badge eden-badge-primary eden-badge-sm">
              {t("settings.apps.dlc")}
            </span>
            <Show when={props.dlc.isPrebuilt}>
              <span class="eden-badge eden-badge-info eden-badge-sm">
                {t("settings.apps.builtin")}
              </span>
            </Show>
          </div>
        </div>
      </div>
      <Show when={!props.dlc.isPrebuilt}>
        <button
          type="button"
          class="eden-btn eden-btn-danger eden-btn-sm eden-btn-icon"
          disabled={props.uninstalling}
          onClick={props.onUninstall}
          title={t("settings.apps.uninstallDlc")}
        >
          <Show when={!props.uninstalling} fallback="...">
            <FiTrash2 />
          </Show>
        </button>
      </Show>
    </div>
    <div class="eden-card-body eden-flex-col eden-gap-lg">
      <p class="eden-text-sm eden-text-secondary">
        {props.dlc.description || t("settings.apps.noDescription")}
      </p>
      <div class="eden-grid eden-grid-2 eden-gap-md">
        <div class="eden-flex eden-flex-col eden-gap-xs">
          <span class="eden-text-xs eden-text-tertiary eden-uppercase eden-font-bold">
            {t("settings.apps.host")}
          </span>
          <span>{props.hostName}</span>
        </div>
        <div class="eden-flex eden-flex-col eden-gap-xs">
          <span class="eden-text-xs eden-text-tertiary eden-uppercase eden-font-bold">
            {t("common.version")}
          </span>
          <span>{props.dlc.version}</span>
        </div>
        <div class="eden-flex eden-flex-col eden-gap-xs">
          <span class="eden-text-xs eden-text-tertiary eden-uppercase eden-font-bold">
            {t("common.size")}
          </span>
          <span>
            <Show when={!props.sizeLoading} fallback={t("common.loading")}>
              {formatBytes(props.size)}
            </Show>
          </span>
        </div>
      </div>
      <div class="eden-flex eden-flex-col eden-gap-sm">
        <h4 class="eden-text-sm eden-font-semibold">
          {t("settings.apps.extensionPoints")}
        </h4>
        <div class="eden-flex eden-flex-wrap eden-gap-xs">
          <For each={props.dlc.contributions}>
            {(contribution) => (
              <span class="eden-tag">
                {contribution.extensionPoint} · {contribution.requires}
              </span>
            )}
          </For>
        </div>
      </div>
    </div>
  </div>
);

export default DlcDetail;
