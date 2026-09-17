import type { SettingsPanelError, SettingsPanelSummary } from "@edenapp/types";
import { FiArrowLeft, FiChevronRight } from "solid-icons/fi";
import { VsSettings } from "solid-icons/vs";
import { type Accessor, type Component, For, Show } from "solid-js";
import { getLocalizedValue, locale, t } from "../i18n";
import type { LoadedPanel, PanelAction } from "../types";
import AppearanceTab from "./AppearanceTab";
import AppsTab from "./apps";
import DaemonsTab from "./daemons/DaemonsTab";
import GenericPanel from "./GenericPanel";

interface SettingsContentProps {
  loading: Accessor<boolean>;
  panels: Accessor<SettingsPanelSummary[]>;
  selectedPanelId: Accessor<string | null>;
  loadedPanel: Accessor<LoadedPanel | null>;
  panelError: Accessor<SettingsPanelError | null>;
  operationError: Accessor<SettingsPanelError | null>;
  busyActions: Accessor<Set<string>>;
  onAction: PanelAction;
  onSelect: (panelId: string) => void;
  onRetry: () => Promise<void>;
}

const PanelRenderer: Component<{
  panel: LoadedPanel;
  busyActions: Accessor<Set<string>>;
  onAction: PanelAction;
}> = (props) => {
  switch (props.panel.renderer) {
    case "generic":
      return <GenericPanel {...props} panel={props.panel} />;
    case "appearance":
      return <AppearanceTab {...props} panel={props.panel} />;
    case "apps":
      return <AppsTab {...props} panel={props.panel} />;
    case "daemons":
      return <DaemonsTab {...props} panel={props.panel} />;
  }
};

const SettingsContent: Component<SettingsContentProps> = (props) => {
  const hasGenericSections = () => {
    const panel = props.loadedPanel();
    return panel?.renderer === "generic" && panel.view.sections.length > 0;
  };
  const children = () => {
    const panelId = props.selectedPanelId();
    return panelId
      ? props.panels().filter((panel) => panel.parentId === panelId)
      : [];
  };
  const lineage = () => {
    const byId = new Map(props.panels().map((panel) => [panel.id, panel]));
    const result: SettingsPanelSummary[] = [];
    let current = props.selectedPanelId();
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      seen.add(current);
      const loaded = props.loadedPanel();
      const panel =
        byId.get(current) ??
        (loaded?.id === current
          ? {
              id: loaded.id,
              parentId: loaded.parentId,
              title: loaded.title,
              description: loaded.description,
              icon: loaded.icon,
              source: loaded.source,
            }
          : undefined);
      if (!panel) break;
      result.unshift(panel);
      current = panel.parentId ?? null;
    }
    return result;
  };

  return (
    <main class="main-content">
      <Show
        when={!props.loading()}
        fallback={
          <output class="loading" aria-live="polite">
            <span class="loading-spinner" aria-hidden="true" />
            {t("common.loading")}
          </output>
        }
      >
        <Show when={props.panelError()}>
          {(error) => (
            <div class="panel-state eden-card eden-card-glass" role="alert">
              <h2>{t(`settings.errors.${error().code}`)}</h2>
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
                <Show when={lineage().length > 1}>
                  <div class="content-navigation">
                    <button
                      type="button"
                      class="content-back"
                      aria-label={t("settings.back")}
                      onClick={() => {
                        const parent = lineage().at(-2);
                        if (parent) props.onSelect(parent.id);
                      }}
                    >
                      <FiArrowLeft />
                    </button>
                    <nav
                      class="content-breadcrumbs"
                      aria-label={t("settings.breadcrumbs")}
                    >
                      <For each={lineage().slice(0, -1)}>
                        {(panel, index) => (
                          <>
                            <Show when={index() > 0}>
                              <FiChevronRight aria-hidden="true" />
                            </Show>
                            <button
                              type="button"
                              onClick={() => props.onSelect(panel.id)}
                            >
                              {getLocalizedValue(panel.title, locale())}
                            </button>
                          </>
                        )}
                      </For>
                    </nav>
                  </div>
                </Show>
                <h1 class="content-title">
                  {getLocalizedValue(loaded().title, locale())}
                </h1>
                <Show when={loaded().description}>
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
                    {t(`settings.errors.${error().code}`)}
                  </div>
                )}
              </Show>
              <Show when={children().length > 0}>
                <div class="settings-children">
                  <For each={children()}>
                    {(panel) => (
                      <button
                        type="button"
                        class="setting-child"
                        onClick={() => props.onSelect(panel.id)}
                      >
                        <span class="setting-child-info">
                          <strong>
                            {getLocalizedValue(panel.title, locale())}
                          </strong>
                          <Show when={panel.description}>
                            {(description) => (
                              <span>
                                {getLocalizedValue(description(), locale())}
                              </span>
                            )}
                          </Show>
                        </span>
                        <FiChevronRight aria-hidden="true" />
                      </button>
                    )}
                  </For>
                </div>
              </Show>
              <Show
                when={
                  loaded().renderer !== "generic" ||
                  hasGenericSections() ||
                  children().length === 0
                }
              >
                <Show when={loaded().renderer} keyed>
                  {(_renderer) => (
                    <PanelRenderer
                      panel={loaded()}
                      busyActions={props.busyActions}
                      onAction={props.onAction}
                    />
                  )}
                </Show>
              </Show>
            </>
          )}
        </Show>
      </Show>
    </main>
  );
};

export default SettingsContent;
