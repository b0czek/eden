import type {
  SettingsPanelGenericSnapshot,
  SettingsPanelView,
} from "@edenapp/types";
import { type Accessor, createEffect, For, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { t } from "../i18n";
import type { PanelAction } from "../types";
import CollectionNode from "./generic-panel/CollectionNode";
import ResolvedNode from "./generic-panel/ResolvedNode";
import { localized } from "./generic-panel/utils";

interface GenericPanelProps {
  panel: SettingsPanelGenericSnapshot;
  busyActions: Accessor<Set<string>>;
  onAction: PanelAction;
}

export default function GenericPanel(props: GenericPanelProps) {
  const [store, setStore] = createStore<SettingsPanelView>({ sections: [] });
  createEffect(() => setStore(reconcile(props.panel.view, { key: "id" })));

  return (
    <div class="settings-list">
      <Show
        when={store.sections.length}
        fallback={<div class="empty-state">{t("settings.emptyPanel")}</div>}
      >
        <For each={store.sections}>
          {(section) => (
            <section class="settings-section">
              <Show when={section.title}>
                <h2 class="settings-section-title">
                  {localized(section.title)}
                </h2>
              </Show>
              <Show when={section.description}>
                {(value) => (
                  <p class="settings-section-description">
                    {localized(value())}
                  </p>
                )}
              </Show>
              <div class="settings-section-card">
                <For each={section.nodes}>
                  {(node) => (
                    <div
                      class={`setting-row${node.kind === "collection" ? " setting-row-collection" : ""}`}
                    >
                      {node.kind === "collection" ? (
                        <CollectionNode
                          node={node}
                          path={`section:${section.id}/node:${node.id}`}
                          busyActions={props.busyActions}
                          onAction={props.onAction}
                        />
                      ) : (
                        <ResolvedNode
                          node={node}
                          path={`section:${section.id}/node:${node.id}`}
                          busyActions={props.busyActions}
                          onAction={props.onAction}
                        />
                      )}
                    </div>
                  )}
                </For>
              </div>
            </section>
          )}
        </For>
      </Show>
    </div>
  );
}
