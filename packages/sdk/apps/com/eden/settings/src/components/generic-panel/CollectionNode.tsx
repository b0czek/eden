import type { SettingsPanelCollectionNode } from "@edenapp/types";
import { type Accessor, For, Show } from "solid-js";
import { t } from "../../i18n";
import type { PanelAction } from "../../types";
import ResolvedNode from "./ResolvedNode";
import { badgeClass, localized } from "./utils";

interface CollectionNodeProps {
  node: SettingsPanelCollectionNode;
  path: string;
  busyActions: Accessor<Set<string>>;
  onAction: PanelAction;
}

export default function CollectionNode(props: CollectionNodeProps) {
  return (
    <div class="settings-collection">
      <Show
        when={props.node.items.length}
        fallback={
          <p class="settings-collection-empty">
            {localized(props.node.emptyLabel) || t("settings.emptyPanel")}
          </p>
        }
      >
        <For each={props.node.items}>
          {(item) => (
            <div class="settings-collection-item">
              <div class="setting-info">
                <div class="settings-collection-heading">
                  <h4 class="setting-label">{localized(item.title)}</h4>
                  <Show when={item.badge}>
                    {(value) => (
                      <span class={`eden-badge${badgeClass(value().tone)}`}>
                        {localized(value().label)}
                      </span>
                    )}
                  </Show>
                </div>
                <Show when={item.description}>
                  {(value) => (
                    <p class="setting-description">{localized(value())}</p>
                  )}
                </Show>
                <Show when={item.detail}>
                  {(value) => (
                    <p class="eden-text-sm eden-text-muted">
                      {localized(value())}
                    </p>
                  )}
                </Show>
              </div>
              <div class="settings-collection-actions">
                <For each={item.nodes}>
                  {(node) => (
                    <div class="settings-row-node">
                      <ResolvedNode
                        node={node}
                        path={`${props.path}/item:${item.id}/node:${node.id}`}
                        inheritedDisabled={item.disabled}
                        busyActions={props.busyActions}
                        onAction={props.onAction}
                      />
                    </div>
                  )}
                </For>
              </div>
            </div>
          )}
        </For>
      </Show>
    </div>
  );
}
