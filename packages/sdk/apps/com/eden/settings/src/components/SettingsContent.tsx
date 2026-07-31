import type { SettingsPanelError } from "@edenapp/types";
import { VsSettings } from "solid-icons/vs";
import { type Accessor, type Component, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import { getLocalizedValue, locale, t } from "../i18n";
import type { LoadedPanel, PanelAction } from "../types";
import AppearanceTab from "./AppearanceTab";
import AppsTab from "./apps";
import DaemonsTab from "./daemons/DaemonsTab";
import GenericPanel from "./GenericPanel";

interface SettingsContentProps {
  loading: Accessor<boolean>;
  loadedPanel: Accessor<LoadedPanel | null>;
  panelError: Accessor<SettingsPanelError | null>;
  operationError: Accessor<SettingsPanelError | null>;
  busyActions: Accessor<Set<string>>;
  onAction: PanelAction;
  onRetry: () => Promise<void>;
}

const SettingsContent: Component<SettingsContentProps> = (props) => {
  const renderers: Record<
    string,
    Component<{
      panel: LoadedPanel;
      busyActions: Accessor<Set<string>>;
      onAction: PanelAction;
    }>
  > = {
    generic: GenericPanel,
    appearance: AppearanceTab,
    apps: AppsTab,
    daemons: DaemonsTab,
  };

  return (
    <main class="main-content">
      <Show
        when={!props.loading()}
        fallback={
          <output class="loading" aria-live="polite">
            <span class="loading-spinner">⟳</span> {t("common.loading")}
          </output>
        }
      >
        <Show when={props.panelError()}>
          {(error) => (
            <div class="panel-state eden-card eden-card-glass" role="alert">
              <h2>{t(`settings.errors.${error().code}`)}</h2>
              <p>{error().message}</p>
              <button
                type="button"
                class="eden-btn eden-btn-primary"
                onClick={() => void props.onRetry()}
              >
                {t("settings.retry")}
              </button>
            </div>
          )}
        </Show>

        <Show
          when={!props.panelError() && props.loadedPanel()}
          fallback={
            <Show when={!props.panelError()}>
              <div class="empty-state">
                <div class="empty-state-icon">
                  <VsSettings />
                </div>
                <div class="empty-state-text">
                  {t("settings.selectCategory")}
                </div>
              </div>
            </Show>
          }
        >
          {(loaded) => (
            <>
              <header class="content-header">
                <h1 class="content-title">
                  {getLocalizedValue(loaded().declaration.title, locale())}
                </h1>
                <Show when={loaded().declaration.description}>
                  {(description) => (
                    <p class="content-description">
                      {getLocalizedValue(description(), locale())}
                    </p>
                  )}
                </Show>
              </header>
              <Show when={props.operationError()}>
                {(error) => (
                  <div class="operation-error" role="alert">
                    {t("settings.operationError")}: {error().message}
                  </div>
                )}
              </Show>
              <Dynamic
                component={
                  renderers[loaded().declaration.renderer] ?? GenericPanel
                }
                panel={loaded()}
                busyActions={props.busyActions}
                onAction={props.onAction}
              />
            </>
          )}
        </Show>
      </Show>
    </main>
  );
};

export default SettingsContent;
