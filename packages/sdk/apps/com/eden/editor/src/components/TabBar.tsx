import { FiX } from "solid-icons/fi";
import { For, Show } from "solid-js";
import { t } from "../i18n";
import type { EditorTab } from "../types";

interface TabBarProps {
  tabs: EditorTab[];
  activeTabId: string | null;
  onTabClick: (tab: EditorTab) => void;
  onTabClose: (tabId: string) => Promise<void>;
}

export function TabBar(props: TabBarProps) {
  const handleTabKeyDown = (tab: EditorTab, e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      props.onTabClick(tab);
    }
  };

  return (
    <div class="editor-tabs" role="tablist">
      <For each={props.tabs}>
        {(tab) => (
          <div
            class={`editor-tab ${props.activeTabId === tab.id ? "active" : ""} ${tab.isModified ? "modified" : ""}`}
            role="tab"
            tabIndex={props.activeTabId === tab.id ? 0 : -1}
            aria-selected={props.activeTabId === tab.id}
            title={tab.path}
            onClick={() => props.onTabClick(tab)}
            onKeyDown={(e) => handleTabKeyDown(tab, e)}
          >
            <span class="tab-name">{tab.name}</span>
            <span class="tab-action">
              <Show when={tab.isModified}>
                <span class="tab-dirty-indicator" aria-hidden="true" />
              </Show>
              <button
                type="button"
                class="tab-close"
                aria-label={`${t("common.close")}: ${tab.name}`}
                title={t("common.close")}
                onClick={(e: MouseEvent) => {
                  e.stopPropagation();
                  void props.onTabClose(tab.id);
                }}
              >
                <FiX aria-hidden="true" size={14} />
              </button>
            </span>
          </div>
        )}
      </For>
    </div>
  );
}
